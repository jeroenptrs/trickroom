import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OTPFieldInput, OTPFieldRoot } from "./otp-field";

describe("Base UI OTP Field rendering", () => {
	it("renders OTP Field parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<OTPFieldRoot className="otp-root" length={4} defaultValue="12">
				<OTPFieldInput className="otp-input" />
				<OTPFieldInput className="otp-input" />
				<OTPFieldInput className="otp-input" />
				<OTPFieldInput className="otp-input" />
			</OTPFieldRoot>,
		);

		expect(markup).toContain('class="otp-root"');
		expect(markup).toContain('class="otp-input"');
		expect(markup).toContain('value="1"');
		expect(markup).toContain('value="2"');
	});

	it("renders standalone OTP Field input without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<OTPFieldInput className="otp-input" />,
		);

		expect(markup).toContain('class="otp-input"');
		expect(markup).toContain("<input");
	});
});
