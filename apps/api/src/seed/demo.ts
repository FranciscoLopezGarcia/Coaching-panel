import type { ActualSet, CoachReview, PlannedSet, SessionFeedback } from '@coaching/engine';
import type { CheckInInput, ParamsInput } from '@coaching/contracts';

/**
 * DATOS 100 % SINTÉTICOS para desarrollo y demo. No provienen de ningún atleta real ni del export de Hevy.
 * Las fechas son relativas a "hoy" para que el dashboard se vea siempre con datos recientes.
 */
export interface DemoAthlete {
  name: string;
  params: ParamsInput;
  /** Versión 1 del plan (si difiere de `planned`, el seed importa las dos y se genera un evento de cambio). */
  planBase: PlannedSet[];
  planned: PlannedSet[];
  actual: ActualSet[];
  checkins: CheckInInput[];
  feedback: SessionFeedback[];
  reviews: CoachReview[];
  competitions: { name: string; daysAhead: number; phase: string }[];
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

interface Sess {
  kg: number;
  /** RPE real: un número para todas las series o uno por serie. */
  rpe: number | number[];
  target?: number | number[];
  sets?: number;
  reps?: number;
  pain?: number;
  fatigue?: number;
}
interface Future {
  kg: number | null;
  sets: number;
  /** Series de la versión 1 del plan (para generar un cambio detectable). */
  setsBase?: number;
}
interface Spec {
  tag: string;
  lift: 'SQ' | 'BP' | 'DL';
  exercise: string;
  slot: string;
  block: string;
  family: string;
  refKg: number | null;
  /** Sesiones SEMANALES ya realizadas; la última fue hace `lastAgo` días. */
  sessions: Sess[];
  lastAgo?: number;
  future?: { block: string; family: string; sessions: Future[] };
}

const pick = (v: number | number[], i: number) => (Array.isArray(v) ? (v[i] as number) : v);

function build(athlete: string, specs: Spec[], today: string, base: boolean) {
  const planned: PlannedSet[] = [];
  const actual: ActualSet[] = [];
  const feedback: SessionFeedback[] = [];
  for (const s of specs) {
    const n = s.sessions.length;
    const last = -(s.lastAgo ?? 2);
    s.sessions.forEach((x, i) => {
      const date = addDays(today, last - 7 * (n - 1 - i));
      const key = `${athlete}-${s.tag}-${s.block}-${i + 1}`;
      const sets = x.sets ?? 3;
      const reps = x.reps ?? 5;
      for (let k = 0; k < sets; k++) {
        const id = `${key}-${k + 1}`;
        const target = x.target === undefined ? 8 : pick(x.target, k);
        planned.push({
          id,
          sessionKey: key,
          slotKey: s.slot,
          exerciseName: s.exercise,
          lift: s.lift,
          plannedDate: date,
          setNo: k + 1,
          reps,
          targetRpe: target,
          plannedKg: x.kg,
          isWarmup: false,
          blockKey: s.block,
          weekNo: i + 1,
          dayNo: weekday(date),
          familyKey: s.family,
          refKg: s.refKg,
          exposureId: `${s.lift.toLowerCase()}-primaria`,
          exposureRole: 'primaria',
          priority: 1,
          variantKey: s.exercise,
          copiedFrom: null,
          plannedKgSource: 'fixed',
          protocol: null,
        });
        actual.push({
          plannedSetId: id,
          status: 'done',
          kg: x.kg,
          reps,
          rpe: pick(x.rpe, k),
          performedOn: date,
          pain: x.pain ?? null,
        });
      }
      if (x.fatigue !== undefined) feedback.push({ sessionKey: key, endFatigue: x.fatigue });
    });
    if (s.future) {
      s.future.sessions.forEach((f, i) => {
        const date = addDays(today, 5 + 7 * i);
        const key = `${athlete}-${s.tag}-${s.future?.block}-f${i + 1}`;
        const weekOffset = s.future?.block === s.block ? n : 0;
        const sets = base ? (f.setsBase ?? f.sets) : f.sets;
        for (let k = 0; k < sets; k++) {
          planned.push({
            id: `${key}-${k + 1}`,
            sessionKey: key,
            slotKey: s.slot,
            exerciseName: s.exercise,
            lift: s.lift,
            plannedDate: date,
            setNo: k + 1,
            reps: 5,
            targetRpe: 8,
            plannedKg: f.kg,
            isWarmup: false,
            blockKey: s.future?.block ?? 'B2',
            weekNo: weekOffset + i + 1,
            dayNo: weekday(date),
            familyKey: s.future?.family ?? s.family,
            refKg: s.refKg,
            exposureId: `${s.lift.toLowerCase()}-primaria`,
            exposureRole: 'primaria',
            priority: 1,
            variantKey: s.exercise,
            copiedFrom: null,
            plannedKgSource: f.kg !== null ? 'fixed' : null,
            protocol: null,
          });
        }
      });
    }
  }
  return { planned, actual, feedback };
}

const minChange = { minChangePct: 1.5, minChangeKg: 2.5 };
const checkin = (today: string, off: number, v: number): CheckInInput => ({
  date: addDays(today, off),
  sleep: v,
  energy: v,
  motivation: v,
  stress: 11 - v,
  pain: 10 - v,
});

export function buildDemoAthletes(today: string): DemoAthlete[] {
  const mk = (
    name: string,
    params: ParamsInput,
    specs: Spec[],
    extra: Partial<Pick<DemoAthlete, 'checkins' | 'reviews' | 'competitions'>> = {},
  ): DemoAthlete => {
    const tag = name.slice(5, 6).toLowerCase();
    const final = build(tag, specs, today, false);
    const baseV = build(tag, specs, today, true);
    return {
      name,
      params,
      planBase: baseV.planned,
      planned: final.planned,
      actual: final.actual,
      feedback: final.feedback,
      checkins: extra.checkins ?? [],
      reviews: extra.reviews ?? [],
      competitions: extra.competitions ?? [],
    };
  };
  const weekly = (v: number, ...offs: number[]) => offs.map((o) => checkin(today, o, v));

  const a = mk(
    'DEMO A · progresa (sintético)',
    {
      perLift: { SQ: minChange, BP: minChange, DL: minChange },
      families: { acumulacion: { objective: 'fuerza' }, 'fuerza-dl': { objective: 'fuerza' } },
    },
    [
      {
        tag: 'sq',
        lift: 'SQ',
        exercise: 'Squat comp',
        slot: 'squat-comp|D1',
        block: 'ACUM-1',
        family: 'acumulacion',
        refKg: 175,
        lastAgo: 2,
        sessions: [145, 145, 147.5, 150, 152.5, 155].map((kg) => ({ kg, rpe: 8 })),
        future: {
          block: 'ACUM-2',
          family: 'acumulacion',
          sessions: [
            { kg: 150, sets: 4, setsBase: 3 },
            { kg: 152.5, sets: 4, setsBase: 3 },
            { kg: 155, sets: 4, setsBase: 3 },
          ],
        },
      },
      {
        tag: 'bp',
        lift: 'BP',
        exercise: 'Bench comp',
        slot: 'bench-comp|D2',
        block: 'FUERZA-1',
        family: 'fuerza-bp',
        refKg: 125,
        lastAgo: 3,
        sessions: [
          { kg: 100, rpe: 8 },
          { kg: 100, rpe: 7 },
          { kg: 100, rpe: 7 },
          { kg: 100, rpe: 7 },
        ],
        future: { block: 'FUERZA-1', family: 'fuerza-bp', sessions: [{ kg: 100, sets: 3 }] },
      },
      {
        tag: 'dl',
        lift: 'DL',
        exercise: 'Deadlift comp',
        slot: 'deadlift-comp|D3',
        block: 'FUERZA-1',
        family: 'fuerza-dl',
        refKg: 220,
        lastAgo: 4,
        sessions: Array.from({ length: 6 }, () => ({ kg: 190, rpe: 8 })),
      },
    ],
    {
      checkins: weekly(8, -3, -10, -17, -24),
      competitions: [{ name: 'Provincial (sintético)', daysAhead: 60, phase: 'Acumulación' }],
    },
  );

  const b = mk(
    'DEMO B · molestia (sintético)',
    { perLift: { SQ: minChange, BP: minChange } },
    [
      {
        tag: 'sq',
        lift: 'SQ',
        exercise: 'Squat comp',
        slot: 'squat-comp|D1',
        block: 'B1',
        family: 'F1',
        refKg: 160,
        lastAgo: 2,
        sessions: [130, 130, 132.5, 137.5, 140, { kg: 142.5, rpe: 8, pain: 5 }].map((x) =>
          typeof x === 'number' ? { kg: x, rpe: 8 } : x,
        ),
      },
      {
        tag: 'bp',
        lift: 'BP',
        exercise: 'Bench comp',
        slot: 'bench-comp|D2',
        block: 'B1',
        family: 'F1',
        refKg: 110,
        lastAgo: 3,
        sessions: [90, 92.5, 92.5, 95].map((kg) => ({ kg, rpe: 8 })),
      },
    ],
    {
      checkins: weekly(7, -9),
      competitions: [{ name: 'Open regional (sintético)', daysAhead: 25, phase: 'Peaking' }],
    },
  );

  const c = mk('DEMO C · incompleto (sintético)', {}, [
    {
      tag: 'sq',
      lift: 'SQ',
      exercise: 'Squat comp',
      slot: 'squat-comp|D1',
      block: 'B1',
      family: 'F1',
      refKg: null,
      lastAgo: 8,
      sessions: [110, 112.5].map((kg) => ({ kg, rpe: 8 })),
    },
  ]);

  const d = mk(
    'DEMO D · fatiga intra-sesión (sintético)',
    { perLift: { SQ: minChange } },
    [
      {
        tag: 'sq',
        lift: 'SQ',
        exercise: 'Squat comp',
        slot: 'squat-comp|D1',
        block: 'B1',
        family: 'F1',
        refKg: 175,
        lastAgo: 2,
        sessions: [
          { kg: 150, rpe: [8, 8, 8] },
          { kg: 150, rpe: [8, 8, 9.5], fatigue: 8 },
          { kg: 150, rpe: [8, 8, 9.5], fatigue: 8 },
          { kg: 150, rpe: [8, 8, 8] },
        ],
      },
    ],
    { checkins: weekly(7, -3, -10) },
  );

  const e = mk(
    'DEMO E · candidato a récord (sintético)',
    { perLift: { SQ: minChange } },
    [
      {
        tag: 'sq',
        lift: 'SQ',
        exercise: 'Squat comp',
        slot: 'squat-comp|D1',
        block: 'B1',
        family: 'F1',
        refKg: 175,
        lastAgo: 2,
        sessions: [
          { kg: 150, rpe: 9.5, target: 9.5 },
          ...Array.from({ length: 6 }, (_, i) => ({ kg: 150, rpe: i < 3 ? 8 : 7, target: i < 3 ? 8 : 7 })),
        ],
      },
    ],
    {
      checkins: weekly(8, -1, -8, -15),
      reviews: [{ lift: 'SQ', date: addDays(today, -4), verdict: 'valida', note: 'técnica comparable' }],
    },
  );
  const f = mk(
    'DEMO F · estable (sintético)',
    { perLift: { SQ: minChange } },
    [
      {
        tag: 'sq',
        lift: 'SQ',
        exercise: 'Squat comp',
        slot: 'squat-comp|D1',
        block: 'B1',
        family: 'F1',
        refKg: 170,
        lastAgo: 2,
        sessions: Array.from({ length: 8 }, () => ({ kg: 120, rpe: 8 })),
      },
    ],
    { checkins: weekly(8, -3, -10) },
  );

  const g = mk(
    'DEMO G · deterioro (sintético)',
    { perLift: { SQ: minChange } },
    [
      {
        tag: 'sq',
        lift: 'SQ',
        exercise: 'Squat comp',
        slot: 'squat-comp|D1',
        block: 'B1',
        family: 'F1',
        refKg: 170,
        lastAgo: 2,
        sessions: [
          { kg: 150, rpe: 8 },
          { kg: 150, rpe: 8.5 },
          { kg: 147.5, rpe: 9 },
          { kg: 145, rpe: 9 },
          { kg: 142.5, rpe: 9.5, fatigue: 8 },
          { kg: 140, rpe: 9.5, fatigue: 9 },
        ],
      },
    ],
    { checkins: weekly(5, -3, -10) },
  );
  return [a, b, c, d, e, f, g];
}
