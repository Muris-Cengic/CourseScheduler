import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { Badge } from "@/components/ui/badge";
import { AlertCircle, CalendarDays, ChevronsDown, ChevronsUp, FileUp, Search, X } from "lucide-react";
import { motion } from "framer-motion";

import studyPlansSeed from "@/data/Study_Plans_2020.json";



/* -------------------- Types -------------------- */
interface FacultyObj { displayName?: string | null }
interface MeetingTime {
  beginTime: string | null;
  endTime: string | null;
  monday: boolean; tuesday: boolean; wednesday: boolean; thursday: boolean; friday: boolean;
  saturday?: boolean; sunday?: boolean;
  buildingDescription?: string | null; room?: string | null;
  meetingScheduleType?: string | null;
}
interface MeetingRecord { meetingTime: MeetingTime }
interface CourseRecord {
  id: number;
  term: string; termDesc: string;
  courseReferenceNumber: string; // CRN
  partOfTerm?: string;
  courseNumber: string;
  subject: string; subjectDescription?: string;
  sequenceNumber?: string; campusDescription?: string;
  scheduleTypeDescription?: string;
  courseTitle: string;
  creditHours?: number | null; creditHourLow?: number | null;
  openSection: boolean;
  maximumEnrollment?: number; enrollment?: number; seatsAvailable?: number;
  faculty?: FacultyObj[]; meetingsFaculty: MeetingRecord[];
}

// Study plans JSON (attached Study_Plans_2020.json)
interface StudyPlanCourse { courseCode: string; courseName: string; prerequisites?: string[] }
interface StudyPlanSemester { term: number; desc: string; courses: StudyPlanCourse[] }
interface StudyPlanYear { year: string; semesters: StudyPlanSemester[] }
interface StudyPlan {
  specialization: string; // e.g. NCS, SSD
  degree: string; // e.g. AB
  year: number; // 2020
  yearlyCourses: StudyPlanYear[];
  technicalElectives?: StudyPlanCourse[]; // added: plan-level electives to replace placeholders (e.g., NCSxxxx)
}

/* -------------------- Helpers -------------------- */
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const DAY_LABEL: Record<(typeof DAYS)[number], string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri",
};

const timeStrToMinutes = (t: string | null) => {
  if (!t || t.length < 3) return null;
  const hh = parseInt(t.slice(0, -2), 10);
  const mm = parseInt(t.slice(-2), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
};

const prettyTime = (t: string | null) => {
  if (!t) return "";
  const m = timeStrToMinutes(t);
  if (m === null) return t;
  let hh = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = ((hh + 11) % 12) + 1;
  return `${hh}:${mm.toString().padStart(2, "0")} ${ampm}`;
};

interface Block {
  day: (typeof DAYS)[number];
  start: number; end: number;
  title: string; crn: string;
  room?: string | null; building?: string | null; type?: string | null; open?: boolean;
}

const blocksForSection = (rec: CourseRecord): Block[] => {
  const out: Block[] = [];
  (rec.meetingsFaculty || []).forEach((m) => {
    const mt = m.meetingTime; if (!mt) return;
    const start = timeStrToMinutes(mt.beginTime);
    const end = timeStrToMinutes(mt.endTime);
    if (start === null || end === null) return;
    DAYS.forEach((d) => {
      if ((mt as any)[d]) {
        out.push({
          day: d,
          start, end,
          title: rec.courseTitle,
          crn: rec.courseReferenceNumber,
          room: mt.room ?? null,
          building: mt.buildingDescription ?? null,
          type: mt.meetingScheduleType ?? null,
          open: rec.openSection,
        });
      }
    });
  });
  return out;
};

const overlap = (a: Block, b: Block) => a.day === b.day && a.start < b.end && b.start < a.end;
const isCompatible = (chosen: Block[], candidate: Block[]) => {
  for (const b of candidate) for (const c of chosen) if (overlap(b, c)) return false;
  return true;
};

// Normalizes "NCS 3301" => "NCS3301"
const normalize = (x: string) => (x || "").replace(/\s+/g, "").toUpperCase();



/* -------------------- Component -------------------- */
export default function CourseScheduler() {
  const [records, setRecords] = useState<CourseRecord[]>([]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [solution, setSolution] = useState<Record<string, CourseRecord> | null>(null);
  const [status, setStatus] = useState<string>("");
  const [conflictCRNs, setConflictCRNs] = useState<Set<string>>(new Set());
  const [activeFindTab, setActiveFindTab] = useState<"offered" | "studyplan">("offered");

  // Study plans state
  const [studyPlans, setStudyPlans] = useState<StudyPlan[]>([]);
  const [activePlanIndex, setActivePlanIndex] = useState<number>(0);
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);


  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // const planFileInputRef = useRef<HTMLInputElement | null>(null);

  /* -------- Upload JSON only -------- */
  const ingestJson = (raw: any) => {
    const arr: CourseRecord[] = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    if (!Array.isArray(arr) || arr.length === 0) { setStatus("JSON parsed, but no records found."); return; }
    setRecords(arr);
    setSolution(null);
    setConflictCRNs(new Set());
    setStatus(`Loaded ${arr.length} sections from JSON`);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const text = await f.text(); ingestJson(JSON.parse(text)); }
    catch (err: any) { setStatus(`Could not parse JSON: ${err?.message ?? err}`); }
    finally { e.target.value = ""; }
  };

  // Upload or auto-load the study plans JSON
  const ingestStudyPlans = (raw: any) => {
    const plans: StudyPlan[] = Array.isArray(raw?.studyPlans) ? raw.studyPlans : Array.isArray(raw) ? raw : [];
    if (!Array.isArray(plans) || plans.length === 0) { setStatus("Study plan JSON parsed, but no study plans found."); return; }
    setStudyPlans(plans);
    setActivePlanIndex(0);
    setExpandedYears({});
    setStatus(`Loaded ${plans.length} study plan${plans.length > 1 ? "s" : ""}.`);
  };

  // Auto-load study plans from /public
  // const loadPlansFromPublic = async () => {
  //   try {
  //     const r = await fetch("/Study_Plans_2020.json", { cache: "no-store" });
  //     if (!r.ok) throw new Error(`HTTP ${r.status}`);
  //     const json = await r.json();
  //     ingestStudyPlans(json);
  //   } catch (err: any) {
  //     setStatus("Could not load Study_Plans_2020.json from /public.");
  //   }
  // };

  // Optionally try to auto-load ./Study_Plans_2020.json if present in public
  useEffect(() => {
    if (studyPlans.length === 0) {
      ingestStudyPlans(studyPlansSeed as any); // (add a proper type if you have one)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------- Derived data -------- */
  const titles = useMemo(() => {
    const list = records
      .filter(r => includeClosed || r.openSection)
      .map(r => `${r.subject}${r.courseNumber} - ${r.courseTitle}`.trim());
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  }, [records, includeClosed]);

  const titleToSections = useMemo(() => {
    const map = new Map<string, CourseRecord[]>();
    records.forEach(r => {
      if (!includeClosed && !r.openSection) return;
      const key = `${r.subject}${r.courseNumber} - ${r.courseTitle}`.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    // prefer open, more seats, earlier start
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        if (a.openSection !== b.openSection) return a.openSection ? -1 : 1;
        const sa = a.seatsAvailable ?? -1, sb = b.seatsAvailable ?? -1;
        if (sb !== sa) return sb - sa;
        const aStarts = blocksForSection(a).map(x => x.start ?? 99999);
        const bStarts = blocksForSection(b).map(x => x.start ?? 99999);
        const aStart = aStarts.length ? Math.min(...aStarts) : 99999;
        const bStart = bStarts.length ? Math.min(...bStarts) : 99999;
        return aStart - bStart;
      });
    }
    return map;
  }, [records, includeClosed]);

  // Map course code (e.g., ICT1201) -> title key used by selections, and offered stats
  const codeToInfo = useMemo(() => {
    const m = new Map<string, { title: string; total: number; open: number }>();
    records.forEach(r => {
      const code = `${r.subject}${r.courseNumber}`.toUpperCase();
      const title = `${r.subject}${r.courseNumber} - ${r.courseTitle}`.trim();
      const prev = m.get(code) ?? { title, total: 0, open: 0 };
      prev.title = title; // last wins (they should be consistent)
      prev.total += 1; prev.open += r.openSection ? 1 : 0;
      m.set(code, prev);
    });
    return m;
  }, [records]);

// Active plan
const activePlan = studyPlans[activePlanIndex];

// course -> Set(prereqs) from plan's per-course "prerequisites"
const prereqMap = useMemo(() => {
  const out = new Map<string, Set<string>>();
  if (!activePlan) return out;

  const add = (code?: string, reqs?: string[]) => {
    const key = normalize(code || "");
    if (!key) return;
    if (!out.has(key)) out.set(key, new Set());
    (reqs || []).forEach(r => out.get(key)!.add(normalize(r)));
  };

  for (const yr of activePlan.yearlyCourses || []) {
    for (const sem of yr.semesters || []) {
      for (const c of sem.courses || []) add(c.courseCode, c.prerequisites);
    }
  }
  for (const e of activePlan.technicalElectives || []) add(e.courseCode, e.prerequisites);
  return out;
}, [activePlan]);

// Inverted graph: course -> Set(courses that depend on it) (direct)
const dependentsAdj = useMemo(() => {
  const m = new Map<string, Set<string>>();
  for (const [course, reqs] of prereqMap.entries()) {
    for (const r of reqs) {
      if (!m.has(r)) m.set(r, new Set());
      m.get(r)!.add(course);
    }
  }
  return m;
}, [prereqMap]);

// ----- Compute direct & indirect sets for current hover -----
const directPrereqs = useMemo(() => {
  if (!hoveredCode) return new Set<string>();
  return new Set(prereqMap.get(hoveredCode) ?? []);
}, [hoveredCode, prereqMap]);

const allPrereqAncestors = useMemo(() => {
  // Walk "prereq" edges up from the hovered course
  const out = new Set<string>();
  if (!hoveredCode) return out;
  const stack = [...(prereqMap.get(hoveredCode) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const up of prereqMap.get(cur) ?? []) stack.push(up);
  }
  return out;
}, [hoveredCode, prereqMap]);

const indirectPrereqs = useMemo(() => {
  const out = new Set<string>(allPrereqAncestors);
  for (const d of directPrereqs) out.delete(d);
  return out;
}, [allPrereqAncestors, directPrereqs]);

const directDependents = useMemo(() => {
  if (!hoveredCode) return new Set<string>();
  return new Set(dependentsAdj.get(hoveredCode) ?? []);
}, [hoveredCode, dependentsAdj]);

const allDependents = useMemo(() => {
  // Walk "dependent" edges down from the hovered course
  const out = new Set<string>();
  if (!hoveredCode) return out;
  const stack = [...(dependentsAdj.get(hoveredCode) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const nxt of dependentsAdj.get(cur) ?? []) stack.push(nxt);
  }
  return out;
}, [hoveredCode, dependentsAdj]);

const indirectDependents = useMemo(() => {
  const out = new Set<string>(allDependents);
  for (const d of directDependents) out.delete(d);
  return out;
}, [allDependents, directDependents]);


  const filteredTitles = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return titles;
    return titles.filter(t => t.toLowerCase().includes(q));
  }, [titles, query]);

  const removeTitle = (t: string) => {
    setSelectedTitles(prev => prev.filter(x => x !== t));
    setSolution(null);
    setConflictCRNs(new Set());
  };

  const findConflicts = (sol: Record<string, CourseRecord>) => {
    const blocks: Block[] = [];
    Object.values(sol).forEach(sec => blocks.push(...blocksForSection(sec)));
    const conflictSet = new Set<string>();
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (overlap(blocks[i], blocks[j])) { conflictSet.add(blocks[i].crn); conflictSet.add(blocks[j].crn); }
      }
    }
    return conflictSet;
  };

  const generateSchedule = () => {
    const chosenBlocks: Block[] = []; const chosen: Record<string, CourseRecord> = {};
    const targetTitles = selectedTitles.filter(t => titleToSections.get(t)?.length);
    if (targetTitles.length === 0) { setStatus("Select at least one course."); setSolution(null); return; }
    const dfs = (i: number): boolean => {
      if (i >= targetTitles.length) return true;
      const t = targetTitles[i]; const candidates = titleToSections.get(t) || [];
      for (const sec of candidates) {
        const blocks = blocksForSection(sec); if (!blocks.length) continue;
        if (isCompatible(chosenBlocks, blocks)) {
          chosen[t] = sec; blocks.forEach(b => chosenBlocks.push(b));
          if (dfs(i + 1)) return true; blocks.forEach(() => chosenBlocks.pop()); delete chosen[t];
        }
      }
      return false;
    };
    const ok = dfs(0);
    if (ok) { const conf = findConflicts(chosen); setSolution({ ...chosen }); setConflictCRNs(conf); setStatus("Schedule generated."); }
    else { setSolution(null); setConflictCRNs(new Set()); setStatus("No conflict-free combination found."); }
  };

  const overrideSection = (title: string, crn: string) => {
    if (!solution) return;
    const options = titleToSections.get(title) || [];
    const pick = options.find(s => s.courseReferenceNumber === crn);
    if (!pick) return;
    const next = { ...solution, [title]: pick };
    const conf = findConflicts(next);
    setSolution(next);
    setConflictCRNs(conf);
    setStatus(conf.size ? "Manual override applied (conflicts highlighted)." : "Manual override applied.");
  };

  const solutionBlocks = useMemo(() => {
    if (!solution) return [] as Block[];
    const out: Block[] = [];
    Object.values(solution).forEach(sec => out.push(...blocksForSection(sec)));
    return out.sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
  }, [solution]);

  // Group blocks by day to avoid repeatedly filtering in render
  const dayBlocks = useMemo(() => {
    const groups: Record<(typeof DAYS)[number], Block[]> = {
      monday: [], tuesday: [], wednesday: [], thursday: [], friday: []
    };
    for (const b of solutionBlocks) groups[b.day].push(b);
    return groups;
  }, [solutionBlocks]);

  // Toggle select from Study Plan using the shared selection state
  const toggleSelectByCode = (codeRaw: string) => {
    const code = normalize(codeRaw);
    const info = codeToInfo.get(code);
    if (!info) return; // not offered in uploaded file
    const title = info.title;
    const available = (titleToSections.get(title) || []).length > 0; // honors includeClosed toggle
    if (!available) return;
    setSelectedTitles(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);
    setSolution(null);
    setConflictCRNs(new Set());
  };

  const isSelectedByCode = (codeRaw: string) => {
    const info = codeToInfo.get(normalize(codeRaw));
    if (!info) return false;
    return selectedTitles.includes(info.title);
  };

  const isPlaceholderElective = (code: string) => /xxxx/i.test(code);


  const clearSelections = () => {
  setSelectedTitles([]);
  setSolution(null);
  setConflictCRNs(new Set());
  setStatus("Cleared selected courses.");
};

  /* -------------------- UI -------------------- */
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 min-h-screen bg-white text-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ISET Course Scheduler</h1>
          <p className="text-sm text-slate-700">Upload available CRNs, select courses, and generate a conflict-free schedule.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFile} />
          <Button variant="default" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="mr-2 h-4 w-4" />
            Upload Sections as JSON
          </Button>


          <Button variant="secondary" onClick={loadPlansFromPublic}>
            Reload Study Plans
          </Button>
        </div>
      </div>

      {/* Status */}
      {status && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status" aria-live="polite">
          <AlertCircle className="h-4 w-4" />
          <span>{status}</span>
        </div>
      )}

      {/* Find courses */}
      <Card className="mt-6">
        <CardHeader className="pb-3"><CardTitle className="text-base">Find courses   
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 ml-10">
            <input
              type="checkbox"
              className="h-4 w-4 accent-black"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
            />
            Include closed sections
          </label></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200">
            {(["offered", "studyplan"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveFindTab(tab)}
                className={[
                  "-mb-px rounded-t-md px-3 py-2 text-sm font-medium",
                  activeFindTab === tab ? "border border-b-white border-slate-200 bg-white" : "text-slate-600 hover:bg-slate-50"
                ].join(" ")}
                aria-pressed={activeFindTab === tab}
              >
                {tab === "offered" ? "Offered Courses" : "Study Plan"}
              </button>
            ))}
          </div>

          {/* Offered tab */}
          {activeFindTab === "offered" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-6 mb-2">
               
                <div className="relative w-full max-w-xl">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by title, subject, or number (e.g. CHEM 1011)"
                    className="pl-9 text-slate-900 placeholder:text-slate-400"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') generateSchedule(); }}
                  />
                </div>
              </div>

              {/* Titles list */}
              <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                <div className="grid [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))] gap-2 p-2">
                  {filteredTitles.map((t) => {
                    const sections = titleToSections.get(t) || [];
                    const count = sections.length;
                    const selected = selectedTitles.includes(t);
                    const anyClosed = sections.some((s) => !s.openSection);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setSelectedTitles((prev) => (selected ? prev.filter((x) => x !== t) : [...prev, t]));
                          setSolution(null);
                          setConflictCRNs(new Set());
                        }}
                        className={[
                          "group flex items-center justify-between rounded-lg border px-3 py-2 text-left",
                          "hover:bg-[#f8fafc] hover:shadow-sm",
                          selected ? "bg-[#eef2ff] border-[#a5b4fc] ring-2 ring-[#c7d2fe]" : "border-[#e2e8f0]",
                        ].join(" ")}
                      >
                        <div className="flex items-center min-w-0">
                          <span className="truncate pr-2 text-[#1f2937]" title={t}>{t}</span>
                          <Badge variant={count ? "secondary" : "destructive"}>{count} sect.</Badge>
                          {anyClosed && (
                            <span
                              className="ml-2 h-2 w-2 rounded-full bg-[#ef4444] flex-shrink-0"
                              aria-label="Has closed sections"
                            />
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {filteredTitles.length === 0 && (
                    <div className="col-span-full flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <AlertCircle className="h-4 w-4" /> No results.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Study Plan tab */}
          {activeFindTab === "studyplan" && (
            <div className="space-y-4">
              {studyPlans.length === 0 && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Place <strong>Study_Plans_2020.json</strong> in <code>/public</code>. It will auto-load on refresh. If you just updated it, click <em>Reload Study Plans</em> above.
                </div>
              )}

              {studyPlans.length > 0 && (
                <>
                  {/* Subtabs for plans */}
                  <div className="flex flex-wrap items-center gap-2 my-3">
                    {studyPlans.map((p, idx) => {
                      const label = `${p.degree}-${p.specialization}-${p.year}`;
                      const active = idx === activePlanIndex;
                      return (
                        <button
                          key={label}
                          onClick={() => setActivePlanIndex(idx)}
                          className={[
                            "rounded-md border px-3 py-1.5 text-sm",
                            active ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 hover:bg-slate-50"
                          ].join(" ")}
                        >{label}</button>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 text-xs text-slate-600 mb-3">
                    <div className="flex items-center gap-1"><span className="inline-block rounded-full" style={{ width: 8, height: 8, background: '#10b981' }} /> Offered</div>
                    <div className="flex items-center gap-1"><span className="inline-block rounded-full" style={{ width: 8, height: 8, background: '#cbd5e1' }} /> Not offered</div>
                    <div className="flex items-center gap-1"><span className="inline-block rounded-sm" style={{ width: 12, height: 12, border: '1px solid #a5b4fc', background: '#eef2ff' }} /> Selected</div>
                    <span>|| On Course Hover:</span>
                    <div className="flex items-center gap-1"><span className="inline-block rounded-sm" style={{ width: 12, height: 12, border: '2px solid #f59e0b', background: '#fff7ed' }} /> Direct prerequisite</div>
                    <div className="flex items-center gap-1"><span className="inline-block rounded-sm" style={{ width: 12, height: 12, border: '2px solid #a855f7', background: '#faf5ff' }} /> Direct dependent</div>
                    <div className="flex items-center gap-1"><span className="inline-block rounded-sm" style={{ width: 12, height: 12, border: '2px dashed #f59e0b', background: '#fffbeb' }} /> Indirect prerequisite</div>
                    <div className="flex items-center gap-1"><span className="inline-block rounded-sm" style={{ width: 12, height: 12, border: '2px dashed #a855f7', background: '#faf5ff' }} /> Indirect dependent</div>
                  </div>

                  {/* Plan content */}
                  {(() => {
                    const plan = studyPlans[activePlanIndex];
                    const electives = (plan.technicalElectives || []).slice().sort((a,b)=>a.courseCode.localeCompare(b.courseCode));
                    return (
                      <div className="space-y-4">
                        {plan.yearlyCourses.map((yr, i) => {
                          const yKey = `${plan.specialization}-${plan.year}-${yr.year}-${i}`;
                          const open = expandedYears[yKey] ?? true;
                          const toggle = () => setExpandedYears(prev => ({ ...prev, [yKey]: !open }));
                          const semesters = [...yr.semesters].sort((a,b)=>a.term-b.term);
                          return (
                            <div key={yKey} className="rounded-md border border-indigo-200">
                              <div className="flex items-center justify-between px-3 py-1 bg-indigo-50">
                                <div className="text-sm font-medium text-indigo-800">{yr.year}</div>
                                <button onClick={toggle} className="text-slate-600 hover:text-slate-800">{open ? <ChevronsUp className="h-4 w-4"/> : <ChevronsDown className="h-4 w-4"/>}</button>
                              </div>
                              {open && (
                                // <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
                                  <div className="grid gap-1 p-1" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                                  {semesters.map((sem) => (
                                    <div key={sem.term} className="rounded-md border border-slate-200">
                                      <div className="px-2 py-1.5 text-sm font-semibold text-slate-800 bg-white border-b border-slate-200">{sem.desc}</div>
                                      <div className="p-0 space-y-1">
                                        {(sem.courses || []).map((c) => {
                                            const code = (c.courseCode || "").toUpperCase();      // for display
                                            const codeKey = normalize(code);                       // for lookups

                                            const info = codeToInfo.get(codeKey);
                                            const offered = !!info;
                                            const selectable = offered && (titleToSections.get(info!.title) || []).length > 0;
                                            const selected = offered && selectedTitles.includes(info!.title);
                                            const placeholder = isPlaceholderElective(codeKey);

                                            // --- hover relations (direct vs indirect) ---
                                            const isDirectPrereq     = !!hoveredCode && directPrereqs.has(codeKey);
                                            const isIndirectPrereq   = !!hoveredCode && indirectPrereqs.has(codeKey);
                                            const isDirectDependent  = !!hoveredCode && directDependents.has(codeKey);
                                            const isIndirectDependent= !!hoveredCode && indirectDependents.has(codeKey);

                                            // --- inline fallback styles (work even if Tailwind fails) ---
                                            const styleHighlight =
                                              isDirectPrereq
                                                ? { outline: "2px solid #f59e0b", backgroundColor: "#fff7ed" } // bright orange (direct prereq)
                                              : isIndirectPrereq
                                                ? { outline: "2px dashed #fcd34d", backgroundColor: "#fffbeb" } // lighter orange (indirect)
                                              : isDirectDependent
                                                ? { outline: "2px solid #a855f7", backgroundColor: "#faf5ff" } // bright purple (direct dependent)
                                              : isIndirectDependent
                                                ? { outline: "2px dashed #d8b4fe", backgroundColor: "#faf5ff" } // lighter purple (indirect)
                                              : undefined;



                                            return (
                                              <div
                                                key={`${sem.term}-${code}`}
                                                onMouseEnter={() => setHoveredCode(codeKey)}
                                                onMouseLeave={() => setHoveredCode(null)}
                                                style={styleHighlight}
                                                className={[
                                                  "flex items-center justify-between gap-2 rounded-md border px-2 py-0.5 text-xs",
                                                  selected ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200",
                                                  // keep utility classes too; fallback styles ensure visibility if they don't compile
                                                  isDirectPrereq    ? "ring-2 ring-[#f59e0b] bg-[#fff7ed]" : "",
                                                  isIndirectPrereq  ? "ring-2 ring-[#fcd34d] bg-[#fffbeb]" : "",
                                                  isDirectDependent ? "ring-2 ring-[#a855f7] bg-[#faf5ff]" : "",
                                                  isIndirectDependent ? "ring-2 ring-[#d8b4fe] bg-[#faf5ff]" : "",
                                                ].join(" ")}
                                              >


                                                <div className="min-w-0">
                                                  <div className="truncate font-medium text-slate-800" title={`${codeKey} ${c.courseName}`}>
                                                    {code.toUpperCase()} <span className="font-normal text-slate-700">{c.courseName}</span>
                                                  </div>
                                                  {placeholder && (
                                                    <div className="text-[11px] text-slate-500">Choose from <em>Electives</em> below.</div>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span
                                                    className={["inline-block h-2 w-2 rounded-full", offered ? "bg-emerald-500" : "bg-slate-300"].join(" ")}
                                                    aria-label={offered ? "Offered" : "Not offered"}
                                                  />
                                                  <Button
                                                    variant={selected ? "secondary" : "outline"}
                                                    className={["h-4 px-2 text-xs", !selectable ? "opacity-50 cursor-not-allowed pointer-events-none" : ""].join(" ")}
                                                    disabled={!selectable}
                                                    aria-disabled={!selectable}
                                                    onClick={() => { if (!selectable) return; toggleSelectByCode(codeKey); }}
                                                  >
                                                    {selected ? "Remove" : "Select"}
                                                  </Button>
                                                </div>
                                              </div>
                                            );
                                          })
                                          }
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Electives list (replaces NCSxxxx Technical Elective I & II) */}
                        {electives.length > 0 && (
                          <div className="rounded-md border border-indigo-200 mt-4">
                            <div className="flex items-center justify-between px-3 py-1 bg-indigo-50">
                              <div className="text-sm font-semibold text-indigo-800">Electives (for Technical Elective I & II)</div>
                            </div>
                             <div className="grid gap-2 p-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                             {electives.map((e) => {
                                const code = (e.courseCode || "").toUpperCase();
                                const codeKey = normalize(code);
                                const info = codeToInfo.get(codeKey);
                                const offered = !!info;
                                const selectable = offered && (titleToSections.get(info!.title) || []).length > 0;
                                const selected = offered && selectedTitles.includes(info!.title);

                                const isDirectPrereq      = !!hoveredCode && directPrereqs.has(codeKey);
                                const isIndirectPrereq    = !!hoveredCode && indirectPrereqs.has(codeKey);
                                const isDirectDependent   = !!hoveredCode && directDependents.has(codeKey);
                                const isIndirectDependent = !!hoveredCode && indirectDependents.has(codeKey);

                                const styleHighlight =
                                  isDirectPrereq 
                                    ? { outline: "2px solid #f59e0b", backgroundColor: "#fff7ed" }
                                  : isIndirectPrereq
                                    ? { outline: "2px dashed #fcd34d", backgroundColor: "#fffbeb" }
                                  : isDirectDependent
                                    ? { outline: "2px solid #a855f7", backgroundColor: "#faf5ff" }
                                  : isIndirectDependent
                                    ? { outline: "2px dashed #d8b4fe", backgroundColor: "#faf5ff" }
                                  : undefined;



                                return (
                                  <div
                                    key={code}
                                    onMouseEnter={() => setHoveredCode(codeKey)}
                                    onMouseLeave={() => setHoveredCode(null)}
                                    style={styleHighlight}
                                    className={[
                                      "flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs",
                                      selected ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200",
                                      isDirectPrereq    ? "ring-2 ring-[#f59e0b] bg-[#fff7ed]" : "",
                                      isIndirectPrereq  ? "ring-2 ring-[#fcd34d] bg-[#fffbeb]" : "",
                                      isDirectDependent ? "ring-2 ring-[#a855f7] bg-[#faf5ff]" : "",
                                      isIndirectDependent ? "ring-2 ring-[#d8b4fe] bg-[#faf5ff]" : "",
                                    ].join(" ")}
                                  >


                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-slate-800" title={`${codeKey} ${e.courseName}`}>
                                        {code.toUpperCase()} <span className="font-normal text-slate-700">{e.courseName}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={["inline-block h-2 w-2 rounded-full", offered ? "bg-emerald-500" : "bg-slate-300"].join(" ")}
                                        aria-label={offered ? "Offered" : "Not offered"}
                                      />
                                      <Button
                                        variant={selected ? "secondary" : "outline"}
                                        className={["h-4 px-2 text-xs", !selectable ? "opacity-50 cursor-not-allowed pointer-events-none" : ""].join(" ")}
                                        disabled={!selectable}
                                        aria-disabled={!selectable}
                                        onClick={() => { if (!selectable) return; toggleSelectByCode(codeKey); }}
                                      >
                                        {selected ? "Remove" : "Select"}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* Selected chips (shared across both tabs) */}
          <div className="rounded-lg border border-slate-200 bg-white p-2 my-4">
            <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Selected ({selectedTitles.length})
            </div>
            <Button
              variant="outline"
              className={["h-7 px-2 text-xs", !selectedTitles.length ? "opacity-50 cursor-not-allowed pointer-events-none" : ""].join(" ")}
              onClick={clearSelections}
              disabled={!selectedTitles.length}
              aria-disabled={!selectedTitles.length}
            >
              Clear
            </Button>
          </div>
            <div className="flex flex-wrap gap-2">
              {selectedTitles.length === 0 && (<span className="text-sm text-slate-500">Nothing selected yet.</span>)}
              {selectedTitles.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                  {t}
                  <button className="rounded-full p-0.5 text-indigo-700/70 hover:bg-indigo-100" onClick={() => removeTitle(t)} title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

         <div className="flex items-center">
          <Button className="w-full justify-center" onClick={generateSchedule}>
            <CalendarDays className="mr-2 h-8 w-4" />
            Generate timetable
          </Button>
        </div>

        </CardContent>
      </Card>

      {/* Selected/Applied sections (full width) */}
      <Card className="mt-6 w-full">
        <CardHeader className="pb-3"><CardTitle className="text-base">Applied sections</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!solution && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Click <strong>Generate</strong> to pick one section per title. You can manually override any section after generation.
            </div>
          )}
          {solution && (
            <div className="w-full overflow-x-auto">
              {/* horizontal scroll on small screens */}
              <div className="grid min-w-[1100px] grid-cols-5 gap-3">
                {Object.entries(solution).map(([title, sec]) => {
                  const options = titleToSections.get(title) || [];
                  const isClosed = !sec.openSection;
                  const hasConflict = conflictCRNs.has(sec.courseReferenceNumber);

                  const mtStrings = (sec.meetingsFaculty || [])
                    .map((m) => {
                      const mt = m.meetingTime; if (!mt) return null;
                      const days = DAYS.filter((d) => (mt as any)[d]).map((d) => DAY_LABEL[d]).join("/");
                      const span = `${prettyTime(mt.beginTime)}–${prettyTime(mt.endTime)}`;
                      return `${days} ${span}`;
                    })
                    .filter(Boolean) as string[];

                  const fmtLabel = (r: CourseRecord) => {
                    const mt = r.meetingsFaculty?.[0]?.meetingTime;
                    const days = mt ? DAYS.filter((d) => (mt as any)[d]).map((d) => DAY_LABEL[d]).join("/") : "";
                    const span = mt ? `${prettyTime(mt.beginTime)}–${prettyTime(mt.endTime)}` : "";
                    return `CRN ${r.courseReferenceNumber} ${days} ${span}${r.openSection ? "" : " • CLOSED"}`;
                  };

                  return (
                    <motion.div
                      key={title}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={[
                        "rounded-md border p-2 text-xs",
                        isClosed ? "bg-red-50 border-red-200" : "bg-white border-slate-200",
                        hasConflict ? "ring-2 ring-amber-300" : "",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800" title={title}>{title}</div>
                        <div className="mt-0.5 text-slate-700">
                          CRN {sec.courseReferenceNumber} • {sec.seatsAvailable ?? 0}/{sec.maximumEnrollment} seats{isClosed ? " • CLOSED" : ""}
                        </div>
                      </div>

                      {mtStrings.length > 0 && (
                        <div className="mt-1 text-slate-700">
                          {mtStrings.map((s, i) => (
                            <span key={i}>
                              • {s}
                              <br />
                            </span>
                          ))}
                        </div>
                      )}

                      <select
                        className="mt-2 w-full rounded-md border border-slate-300 bg-white p-1.5 text-xs"
                        value={sec.courseReferenceNumber}
                        onChange={(e) => overrideSection(title, e.target.value)}
                        aria-label="Override section"
                      >
                        {options.map((o) => (
                          <option key={o.courseReferenceNumber} value={o.courseReferenceNumber}>{fmtLabel(o)}</option>
                        ))}
                      </select>

                      {hasConflict && (
                        <div className="mt-2 rounded-md bg-amber-50 p-1.5 text-[11px] text-amber-700">
                          Conflicts with another selection. Try a different CRN.
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly timetable (full width, DAYS side-by-side columns) */}
      <Card className="mt-6 w-full">
        <CardHeader className="pb-3"><CardTitle className="text-base">Weekly timetable</CardTitle></CardHeader>
        <CardContent>
          {!solution && (<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Generate a schedule to see the timetable.</div>)}
          {solution && (
            <div className="w-full overflow-x-auto">
              <div className="grid min-w-[1100px] grid-cols-5 gap-3">
                {DAYS.map((d) => (
                  <div key={d} className="min-h-[480px] rounded-md border border-slate-200 bg-white py-2 px-1">
                    <div className="mb-2 text-sm font-semibold text-slate-800">{DAY_LABEL[d]}</div>
                    <div className="space-y-2">
                      {dayBlocks[d].map((b, i) => {
                        const conflict = conflictCRNs.has(b.crn);
                        return (
                          <div key={i} className={["rounded-md border p-2 text-xs leading-tight mb-1", b.open ? "bg-slate-50 border-slate-200" : "bg-red-50 border-red-200", conflict ? "ring-2 ring-amber-300" : ""].join(" ")}>
                            <div className="truncate font-medium text-slate-800">{b.title}</div>
                            <div className="text-slate-700">
                              {prettyTime(String(Math.floor(b.start / 60)).padStart(2, "0") + String(b.start % 60).padStart(2, "0"))}
                              {"–"}
                              {prettyTime(String(Math.floor(b.end / 60)).padStart(2, "0") + String(b.end % 60).padStart(2, "0"))}
                              {" | "}
                              [CRN{b.crn}]
                              [{b.type ? `${b.type}` : ""}]
                            </div>
                            <div className="text-slate-700"> </div>
                            <div className="text-slate-700">{!b.open ? " • CLOSED" : ""}</div>
                          </div>
                        );
                      })}
                      {dayBlocks[d].length === 0 && (<div className="text-xs text-slate-500">No classes</div>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
