// Asks a person to confirm what a command deletes.

import { createInterface } from "node:readline";

/** Whether the person answers yes to `question`. Input that ends unanswered, as with Ctrl-C or when nothing can be typed, is a no. */
export async function confirmed(question: string): Promise<boolean> {
	const input = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		input.once("close", () => resolve(""));
		input.question(question, resolve);
	});
	input.close();
	return /^y(es)?$/i.test(answer.trim());
}
