// Plants one bug from measure/mutants.json into the checkout, or prints the
// cells of measure/run.json for the workflow.
//
//   node measure/apply.mjs --cells     cells=<json> for $GITHUB_OUTPUT
//   node measure/apply.mjs base-03     does nothing: the code as it is
//   node measure/apply.mjs m07         plants bug m07
//   node measure/apply.mjs --check     every bug's text is found exactly once
//
// A bug is one or more edits: { file, find, replace }. `find` must be in the
// file exactly once, so a bug can never be planted in the wrong place or not
// at all without this failing.
import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const mutants = () => read("./mutants.json");

function edits(mutant) {
  return mutant.edits.map(({ file, find, replace }) => {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const count = text.split(find).length - 1;
    if (count !== 1) throw new Error(`${mutant.id}: the text to replace is in ${file} ${count} times, not once:\n${find}`);
    if (find === replace) throw new Error(`${mutant.id}: the replacement is the same text`);
    return { file, text: text.replace(find, () => replace) };
  });
}

const [arg] = process.argv.slice(2);
if (arg === "--cells") {
  console.log(`cells=${JSON.stringify(read("./run.json").cells)}`);
} else if (arg === "--check") {
  const all = mutants();
  const ids = new Set();
  for (const mutant of all) {
    if (ids.has(mutant.id)) throw new Error(`${mutant.id} is listed twice`);
    ids.add(mutant.id);
    edits(mutant);
  }
  console.log(`${all.length} planted bugs, each found exactly once.`);
} else if (/^base-\d+$/.test(arg ?? "")) {
  console.log(`${arg}: the code as it is.`);
} else {
  const mutant = mutants().find((entry) => entry.id === arg);
  if (!mutant) throw new Error(`No planted bug is named ${arg}`);
  for (const { file, text } of edits(mutant)) writeFileSync(file, text);
  console.log(`${mutant.id} planted: ${mutant.what}`);
}
