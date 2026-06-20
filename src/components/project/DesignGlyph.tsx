import type { ReactNode } from "react";
import type { TrickroomDesignSummary } from "../../types";

function hash32(s: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(a: number) {
	let s = a >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type DesignGlyphTuning = {
	strokeOpacity: number;
	strokeWidth: number;
	samples: number;
	dt: number;
	dampingScale: number;
	detuneScale: number;
	radius: number;
	seedOffset: number;
};

export const designGlyphDefaults: DesignGlyphTuning = {
	strokeOpacity: 0.69,
	strokeWidth: 0.45,
	samples: 2400,
	dt: 0.04,
	dampingScale: 1,
	detuneScale: 1,
	radius: 76,
	seedOffset: 13,
};

type GlyphInput = Pick<
	TrickroomDesignSummary,
	"uuid" | "boardsCount" | "layersCount"
>;

export function DesignGlyph({
	design,
	className,
	tuning,
}: {
	design: GlyphInput;
	className?: string;
	tuning?: Partial<DesignGlyphTuning>;
}) {
	const t = { ...designGlyphDefaults, ...(tuning ?? {}) };
	const seed =
		hash32(`${design.uuid}:${design.boardsCount}:${design.layersCount}`) ^
		(t.seedOffset >>> 0);
	const rand = mulberry32(seed);
	const hue = 184 + Math.floor(rand() * 16);

	const pickBase = (arr: number[]) => arr[Math.floor(rand() * arr.length)];
	const detune = () => (rand() - 0.5) * 0.06 * t.detuneScale;
	const f1 = pickBase([2, 3]) + detune();
	const f2 = pickBase([3, 4, 5]) + detune();
	const f3 = pickBase([2, 3]) + detune();
	const f4 = pickBase([3, 4, 5]) + detune();
	const p1 = rand() * Math.PI * 2;
	const p2 = rand() * Math.PI * 2;
	const p3 = rand() * Math.PI * 2;
	const p4 = rand() * Math.PI * 2;
	const d1 = (0.001 + rand() * 0.004) * t.dampingScale;
	const d2 = (0.001 + rand() * 0.004) * t.dampingScale;
	const d3 = (0.001 + rand() * 0.004) * t.dampingScale;
	const d4 = (0.001 + rand() * 0.004) * t.dampingScale;
	const A1 = 0.55 + rand() * 0.2;
	const A2 = 0.25 + rand() * 0.2;
	const A3 = 0.55 + rand() * 0.2;
	const A4 = 0.25 + rand() * 0.2;

	const VB = 200;
	const cx = VB / 2;
	const cy = VB / 2;
	const R = t.radius;

	const pts: string[] = [];
	for (let i = 0; i <= t.samples; i++) {
		const time = i * t.dt;
		const x =
			cx +
			R *
				(A1 * Math.sin(f1 * time + p1) * Math.exp(-d1 * time) +
					A2 * Math.sin(f2 * time + p2) * Math.exp(-d2 * time));
		const y =
			cy +
			R *
				(A3 * Math.sin(f3 * time + p3) * Math.exp(-d3 * time) +
					A4 * Math.sin(f4 * time + p4) * Math.exp(-d4 * time));
		pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
	}

	const gridStep = 25;
	const gridLines: ReactNode[] = [];
	for (let v = -gridStep; v <= VB + gridStep; v += gridStep) {
		gridLines.push(
			<line key={`gv${v}`} x1={v} y1={-40} x2={v} y2={VB + 40} />,
			<line key={`gh${v}`} x1={-40} y1={v} x2={VB + 40} y2={v} />,
		);
	}

	const bgGradId = `tr-bg-${design.uuid}`;

	return (
		<svg
			viewBox={`0 0 ${VB} ${VB}`}
			className={className}
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
		>
			<defs>
				<linearGradient id={bgGradId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor={`hsl(${hue} 80% 65%)`} />
					<stop offset="100%" stopColor={`hsl(${hue} 70% 34%)`} />
				</linearGradient>
			</defs>

			<rect
				x={-40}
				y={-40}
				width={VB + 80}
				height={VB + 80}
				fill={`url(#${bgGradId})`}
			/>

			<g stroke="white" strokeOpacity="0.16" strokeWidth="0.5">
				{gridLines}
			</g>

			<polyline
				points={pts.join(" ")}
				fill="none"
				stroke="white"
				strokeOpacity={t.strokeOpacity}
				strokeWidth={t.strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
