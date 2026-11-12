/** Pure project-file validation and a small dependency-free ZIP writer. */
export type ProjectFile = { path: string; content: string };
export type ProjectDocument = {
  id: string; templateId: ProjectTemplateId; title: string; description: string; code: string;
  files: ProjectFile[]; repoUrl: string; status: "draft" | "building" | "published";
};
export const PROJECT_LIMIT = 20;
export const FILE_LIMIT = 12;
export const FILE_BYTES = 40_000;
export const PROJECT_BYTES = 160_000;
const encoder = new TextEncoder();
export const byteLength = (value: string) => encoder.encode(value).byteLength;

export function validateFilePath(path: string, allowWorkflow = false): string | null {
  if (!path || path.length > 160 || !/^[a-zA-Z0-9_.\-/]+$/.test(path) || path.startsWith("/") || path.endsWith("/")) return "Use a relative file path of at most 160 letters, numbers, dots, dashes, underscores, or slashes.";
  const segments = path.split("/");
  if (segments.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return "A file path cannot contain empty folders, .git, or parent-directory steps.";
  if (segments.some(part => /^\.env(?:\.|$)/i.test(part))) return "Keep environment files and credentials outside this workspace.";
  if (segments.some(part => part.toLowerCase() === ".github") && !(allowWorkflow && path === ".github/workflows/test.yml")) return "GitHub configuration files are download-only in this workspace.";
  return null;
}

/** A ZIP cannot extract a regular file and a folder at the same path. */
export function validateFileHierarchy(files: Pick<ProjectFile, "path">[]): string | null {
  const paths = new Set(files.map(file => file.path.toLowerCase()));
  for (const file of files) {
    const segments = file.path.split("/");
    for (let end = 1; end < segments.length; end++) {
      const parent = segments.slice(0, end).join("/");
      if (paths.has(parent.toLowerCase())) return `“${parent}” is already a file. Use a different folder name or remove that file before adding nested files.`;
    }
  }
  return null;
}

export function validateFiles(files: unknown): string | null {
  if (!Array.isArray(files) || files.length < 1 || files.length > FILE_LIMIT) return `A project needs 1–${FILE_LIMIT} files.`;
  const seen = new Set<string>(); let total = 0;
  for (const file of files) {
    if (!file || typeof file !== "object" || typeof file.path !== "string" || typeof file.content !== "string") return "Each file needs a path and text contents.";
    const pathError = validateFilePath(file.path); if (pathError) return pathError;
    const key = file.path.toLowerCase(); if (seen.has(key)) return "File paths must be unique, including capitalization."; seen.add(key);
    const size = byteLength(file.content); if (size > FILE_BYTES) return `${file.path} is larger than 40,000 bytes. Shorten it before saving.`;
    total += size;
  }
  if (total > PROJECT_BYTES) return "Project files must fit within 160,000 bytes in total.";
  if (!files.some(file => file.path === "main.py")) return "Keep a main.py entry point in this Python project.";
  return null;
}

/** Rename atomically so a failed validation never loses a file or its contents. */
export function renameProjectFile(project: ProjectDocument, from: string, to: string): ProjectDocument {
  if (from === "main.py") throw new Error("Keep main.py as the Python entry point.");
  if (!project.files.some(file => file.path === from)) throw new Error("The file to rename no longer exists.");
  const files = project.files.map(file => file.path === from ? { ...file, path: to } : file);
  const problem = validateFiles(files) || validateFileHierarchy(files);
  if (problem) throw new Error(problem);
  return withFiles(project, files);
}

export function validProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(p.id) && !["constructor", "prototype", "__proto__"].includes(p.id) &&
    typeof p.templateId === "string" && ["study-tracker", "graph-toolkit", "test-bench"].includes(p.templateId) &&
    typeof p.title === "string" && p.title.length <= 120 && typeof p.description === "string" && p.description.length <= 2000 &&
    typeof p.code === "string" && p.code.length <= 40000 && typeof p.repoUrl === "string" && p.repoUrl.length <= 300 &&
    ["draft", "building", "published"].includes(p.status as string) && validateFiles(p.files) === null;
}

export function withFiles(project: ProjectDocument, files: ProjectFile[]): ProjectDocument {
  return { ...project, files, code: files.find(file => file.path === "main.py")?.content || "" };
}

export function projectContentEqual(a: ProjectDocument, b: ProjectDocument) {
  return a.id === b.id && a.templateId === b.templateId && a.title === b.title && a.description === b.description && a.repoUrl === b.repoUrl && a.status === b.status &&
    a.files.length === b.files.length && a.files.every(file => b.files.some(other => other.path === file.path && other.content === file.content));
}

const crcTable = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1); return crc >>> 0; });
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Stored ZIP entries preserve nested paths and UTF-8 text without compression dependencies. */
export function createProjectZip(files: ProjectFile[]): Uint8Array<ArrayBuffer> {
  if (files.length < 1 || files.length > FILE_LIMIT + 1) throw new Error("The archive contains too many files.");
  const hierarchyError = validateFileHierarchy(files); if (hierarchyError) throw new Error(hierarchyError);
  const seen = new Set<string>(); let total = 0;
  const entries = files.map(file => {
    const error = validateFilePath(file.path, true); if (error) throw new Error(error);
    const lower = file.path.toLowerCase(); if (seen.has(lower)) throw new Error("Duplicate archive path."); seen.add(lower);
    const name = encoder.encode(file.path); const data = encoder.encode(file.content);
    if (data.length > FILE_BYTES) throw new Error("An archive file is too large."); total += data.length;
    return { name, data, crc: crc32(data), offset: 0 };
  });
  if (total > PROJECT_BYTES + FILE_BYTES) throw new Error("The archive is too large.");
  const localLength = entries.reduce((size, item) => size + 30 + item.name.length + item.data.length, 0);
  const directoryLength = entries.reduce((size, item) => size + 46 + item.name.length, 0);
  const output = new Uint8Array(localLength + directoryLength + 22); const view = new DataView(output.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  let offset = 0;
  for (const item of entries) {
    item.offset = offset; u32(offset, 0x04034b50); u16(offset + 4, 20); u16(offset + 6, 0x0800); u16(offset + 8, 0); u16(offset + 10, 0); u16(offset + 12, 33);
    u32(offset + 14, item.crc); u32(offset + 18, item.data.length); u32(offset + 22, item.data.length); u16(offset + 26, item.name.length); u16(offset + 28, 0);
    output.set(item.name, offset + 30); output.set(item.data, offset + 30 + item.name.length); offset += 30 + item.name.length + item.data.length;
  }
  const directoryOffset = offset;
  for (const item of entries) {
    u32(offset, 0x02014b50); u16(offset + 4, 20); u16(offset + 6, 20); u16(offset + 8, 0x0800); u16(offset + 10, 0); u16(offset + 12, 0); u16(offset + 14, 33);
    u32(offset + 16, item.crc); u32(offset + 20, item.data.length); u32(offset + 24, item.data.length); u16(offset + 28, item.name.length); u16(offset + 30, 0); u16(offset + 32, 0); u16(offset + 34, 0); u16(offset + 36, 0); u32(offset + 38, 0); u32(offset + 42, item.offset);
    output.set(item.name, offset + 46); offset += 46 + item.name.length;
  }
  u32(offset, 0x06054b50); u16(offset + 4, 0); u16(offset + 6, 0); u16(offset + 8, entries.length); u16(offset + 10, entries.length); u32(offset + 12, directoryLength); u32(offset + 16, directoryOffset); u16(offset + 20, 0);
  return output;
}

export const PROJECT_TEMPLATES=[{id:'study-tracker',title:'Study session tracker',description:'A small command-line tool that turns study minutes into a useful weekly report. Add tests, validation, and a clear README.',level:'FIRST BUILD',skills:['Python','Files','Testing'],brief:'Build a command-line study tracker. A session has a date, topic, and duration. Save sessions in JSON, summarize totals by topic, and reject negative durations. Add a helpful usage message.',code:`"""Forge study tracker: a small program you can make your own."""
import json
from pathlib import Path


def summarize(sessions):
    """Return total minutes for each topic. Reject invalid durations."""
    totals = {}
    for session in sessions:
        minutes = session["minutes"]
        if not isinstance(minutes, (int, float)) or minutes <= 0:
            raise ValueError("Session minutes must be positive")
        topic = session["topic"].strip()
        if not topic:
            raise ValueError("A topic is required")
        totals[topic] = totals.get(topic, 0) + minutes
    return totals


def save_sessions(sessions, filename="sessions.json"):
    summarize(sessions)  # Validate before writing.
    Path(filename).write_text(json.dumps(sessions, indent=2))


if __name__ == "__main__":
    example = [{"topic": "Python", "minutes": 25},
               {"topic": "Git", "minutes": 15}]
    for topic, minutes in summarize(example).items():
        print(f"{topic}: {minutes} minutes")
`,tests:`import unittest
from main import summarize

class StudyTrackerTests(unittest.TestCase):
    def test_aggregates_topics(self):
        self.assertEqual(summarize([{"topic":"Python","minutes":20},
                                    {"topic":"Python","minutes":10}]), {"Python":30})
    def test_empty(self):
        self.assertEqual(summarize([]), {})
    def test_negative_minutes(self):
        with self.assertRaises(ValueError):
            summarize([{"topic":"Git","minutes":-1}])

if __name__ == "__main__":
    unittest.main()
`},{id:'graph-toolkit',title:'Graph explorer',description:'Turn graph theory into an importable Python library. Implement and test a shortest-path tool.',level:'ALGORITHM PROJECT',skills:['Graphs','BFS','API design'],brief:'Create a graph toolkit with breadth-first search, path reconstruction, and disconnected-graph handling. Document the input model, prove correctness, and measure O(V + E) behavior.',code:`"""Shortest unweighted paths, with explicit unreachable results."""
from collections import deque


def shortest_path(graph, start, goal):
    queue = deque([start])
    parent = {start: start}
    while queue:
        node = queue.popleft()
        if node is goal or node == goal:
            path = [node]
            while node is not start and node != start:
                node = parent[node]
                path.append(node)
            return path[::-1]
        for neighbor in graph.get(node, []):
            if neighbor not in parent:
                parent[neighbor] = node
                queue.append(neighbor)
    return None


if __name__ == "__main__":
    print(shortest_path({"A":["B"], "B":["C"], "C":[]}, "A", "C"))
`,tests:`import unittest
from main import shortest_path

class GraphTests(unittest.TestCase):
    def test_path(self):
        self.assertEqual(shortest_path({0:[1], 1:[2]}, 0, 2), [0,1,2])
    def test_unreachable(self):
        self.assertIsNone(shortest_path({0:[],1:[]}, 0, 1))
    def test_cycle(self):
        self.assertEqual(shortest_path({0:[1],1:[0,2]}, 0, 2), [0,1,2])
    def test_same_node(self):
        self.assertEqual(shortest_path({}, 0, 0), [0])
    def test_none_is_a_valid_vertex(self):
        cases = [
            ({}, None, None, [None]),
            ({None: ["end"]}, None, "end", [None, "end"]),
            ({"start": [None]}, "start", None, ["start", None]),
            ({"start": [None], None: ["end"]}, "start", "end", ["start", None, "end"]),
        ]
        for graph, start, goal, expected in cases:
            with self.subTest(start=start, goal=goal):
                self.assertEqual(shortest_path(graph, start, goal), expected)
    def test_non_reflexive_vertex_identity(self):
        vertex = float("nan")
        self.assertEqual(shortest_path({}, vertex, vertex), [vertex])
        self.assertEqual(shortest_path({vertex: ["end"]}, vertex, "end"), [vertex, "end"])
        self.assertEqual(shortest_path({"start": [vertex]}, "start", vertex), ["start", vertex])

if __name__ == "__main__":
    unittest.main()
`},{id:'test-bench',title:'The edge-case test bench',description:'Practice the work behind reliable software: specifications, regression tests, and reproducible bug reports.',level:'ENGINEERING PROJECT',skills:['Quality','Evaluation','Test design'],brief:'Specify a slug function precisely, build an adversarial test set, and explain each boundary case. Create a regression test for every bug before fixing it. Compare alternate implementations using a reproducible rubric.',code:`"""A conservative ASCII slug function with documented behavior."""
import re


def slugify(text):
    """Lowercase ASCII letters and digits; runs of other chars become '-'."""
    if not isinstance(text, str):
        raise TypeError("Expected a string")
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


if __name__ == "__main__":
    for example in ["Hello, World!", "  Multiple   spaces  ", "---"]:
        print(repr(example), "->", repr(slugify(example)))
`,tests:`import unittest
from main import slugify

class SlugTests(unittest.TestCase):
    def test_words(self):
        self.assertEqual(slugify("Hello, World!"), "hello-world")
    def test_empty(self):
        self.assertEqual(slugify(""), "")
    def test_only_symbols(self):
        self.assertEqual(slugify("---"), "")
    def test_idempotence(self):
        for s in ["Hello!", "Already-a-slug", "42"]:
            self.assertEqual(slugify(slugify(s)), slugify(s))

if __name__ == "__main__":
    unittest.main()
`}];
export const WORKFLOW_STARTER=`name: Python checks
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python -m unittest discover -v
`;

export type ProjectTemplateId = "study-tracker" | "graph-toolkit" | "test-bench";
export function projectStarterFiles(templateId: string): ProjectFile[] {
  const template = PROJECT_TEMPLATES.find(item => item.id === templateId) || PROJECT_TEMPLATES[0];
  return [
    { path: "main.py", content: template.code },
    { path: "test_main.py", content: template.tests },
    { path: "README.md", content: `# ${template.title}\n\n${template.description}\n\n## Objective\n\n${template.brief}\n\n## Run\n\nRequires Python 3.10 or later.\n\n\`\`\`sh\npython main.py\npython -m unittest discover -v\n\`\`\`\n\n## Design notes\n\nExplain your choices, complexity, and assumptions here.\n\n## Tests\n\nList covered cases, untested risks, and the command used.\n\n## What I learned\n\nDescribe your own changes. Starter code was provided by Forge.\n` },
    { path: ".gitignore", content: "__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.pytest_cache/\n.env\n.env.*\n.DS_Store\nsessions.json\n" },
  ];
}
export function createProject(templateId: string, id = `project-${crypto.randomUUID()}`): ProjectDocument {
  const template = PROJECT_TEMPLATES.find(item => item.id === templateId) || PROJECT_TEMPLATES[0];
  return { id, templateId: template.id as ProjectTemplateId, title: template.title, description: template.description, code: template.code, files: projectStarterFiles(template.id), repoUrl: "", status: "building" };
}
/** Legacy single-file drafts retain their exact main.py and receive editable support files. */
export function normalizeSavedProject(project: Omit<ProjectDocument, "files" | "templateId"> & { files?: ProjectFile[]; templateId?: string }): ProjectDocument {
  const templateId = (project.templateId || (PROJECT_TEMPLATES.some(item => item.id === project.id) ? project.id : "study-tracker")) as ProjectTemplateId;
  const files = project.files?.length ? project.files.map(file => ({ ...file })) : projectStarterFiles(templateId).map(file => file.path === "main.py" ? { ...file, content: project.code } : file);
  return withFiles({ ...project, templateId, files }, files);
}
