/** Offsets to 1-based line and column, for finding locations. */
export type LineIndex = {
	position: (offset: number) => { line: number; column: number };
	lineCount: number;
};

export const createLineIndex = (text: string): LineIndex => {
	const starts = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) {
			starts.push(index + 1);
		}
	}
	return {
		lineCount: text.endsWith("\n") ? starts.length - 1 : starts.length,
		position: (offset) => {
			let low = 0;
			let high = starts.length - 1;
			while (low < high) {
				const mid = (low + high + 1) >> 1;
				if (starts[mid] <= offset) {
					low = mid;
				} else {
					high = mid - 1;
				}
			}
			return { line: low + 1, column: offset - starts[low] + 1 };
		},
	};
};
