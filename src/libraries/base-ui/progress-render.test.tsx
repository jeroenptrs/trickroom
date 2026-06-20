import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	ProgressIndicator,
	ProgressLabel,
	ProgressRoot,
	ProgressTrack,
	ProgressValue,
} from "./progress";

describe("Base UI Progress rendering", () => {
	it("renders Progress parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<ProgressRoot className="progress-root" value={25} min={0} max={100}>
				<ProgressLabel className="progress-label">Loading</ProgressLabel>
				<ProgressTrack className="progress-track">
					<ProgressIndicator className="progress-indicator" />
				</ProgressTrack>
				<ProgressValue className="progress-value" />
			</ProgressRoot>,
		);

		expect(markup).toContain('class="progress-root"');
		expect(markup).toContain('class="progress-label"');
		expect(markup).toContain('class="progress-track"');
		expect(markup).toContain('class="progress-indicator"');
		expect(markup).toContain('class="progress-value"');
		expect(markup).toContain("25%");
	});

	it("renders standalone Progress parts without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<ProgressTrack className="progress-track">
				<ProgressIndicator className="progress-indicator" />
			</ProgressTrack>,
		);

		expect(markup).toContain('class="progress-track"');
		expect(markup).toContain('class="progress-indicator"');
	});
});
