// Asks a person a question in the terminal: to confirm what a command deletes, or for what a project lacks, such as a key.

import { createInterface } from "node:readline";

/** The person's answer to `question`, trimmed; undefined when input ends unanswered, as with Ctrl-C or when nothing can be typed. */
export async function answer(question: string): Promise<string | undefined> {
	const input = createInterface({ input: process.stdin, output: process.stdout });
	const text = await new Promise<string | undefined>((resolve) => {
		input.once("close", () => resolve(undefined));
		input.question(question, resolve);
	});
	input.close();
	return text?.trim();
}

/** Whether the person answers yes to `question`. Input that ends unanswered is a no. */
export async function confirmed(question: string): Promise<boolean> {
	return /^y(es)?$/i.test((await answer(question)) ?? "");
}
