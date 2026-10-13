// postcss exports its tokenizer (`postcss/lib/tokenize`) without types.
declare module "postcss/lib/tokenize" {
	import type { Input } from "postcss";

	/** `[type, content, …positions]`: "word", "space", "string", "comment", "{", … */
	export type Token = [string, string, ...number[]];

	export type Tokenizer = {
		nextToken(): Token;
		endOfFile(): boolean;
	};

	export default function tokenizer(
		input: Input,
		options?: { ignoreErrors?: boolean },
	): Tokenizer;
}
