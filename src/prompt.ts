import * as readline from 'node:readline/promises';

let sharedInterface: readline.Interface | null = null;
let sharedIterator: AsyncIterator<string> | null = null;

function getState(): { rl: readline.Interface; iterator: AsyncIterator<string> } {
  if (!sharedInterface) {
    sharedInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Using the interface as an async iterable (rather than rl.question())
    // ensures lines delivered in a single buffered write (e.g. piped stdin
    // in tests) are queued and consumed in order across multiple prompts,
    // instead of being dropped when no `question()` call is pending yet.
    sharedIterator = sharedInterface[Symbol.asyncIterator]();
  }
  return { rl: sharedInterface, iterator: sharedIterator! };
}

/**
 * Ask a single question and return the trimmed answer.
 * If stdin closes before an answer is provided (e.g. piped input runs out),
 * resolves with an empty string instead of throwing or hanging.
 */
export async function ask(question: string): Promise<string> {
  const { iterator } = getState();
  process.stdout.write(question);
  try {
    const { value, done } = await iterator.next();
    if (done || value === undefined) {
      return '';
    }
    return value.trim();
  } catch {
    // Stream errors while reading (e.g. destroyed stdin) — treat as no answer.
    return '';
  }
}

/**
 * Ask a sequence of questions, one at a time, sharing a single readline
 * interface so output/input never interleaves. Closes the interface when
 * done so the process isn't kept alive by an open stdin listener.
 */
export async function askSequence(
  questions: { key: string; text: string }[],
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  for (const { key, text } of questions) {
    answers[key] = await ask(text);
  }
  closePrompt();
  return answers;
}

/**
 * Close the shared readline interface, if open. Safe to call multiple times.
 */
export function closePrompt(): void {
  if (sharedInterface) {
    sharedInterface.close();
    sharedInterface = null;
    sharedIterator = null;
  }
}
