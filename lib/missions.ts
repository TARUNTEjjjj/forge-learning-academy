export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type MissionCase = { label: string; args: JsonValue[]; expected: JsonValue; sample?: boolean };
export type Mission = {
  id: string; title: string; category: string; level: string; minutes: number;
  brief: string; contract: string; intuition: string; starter: string; functionName: string;
  hints: string[]; tests: MissionCase[]; resource: { label: string; url: string }; next: string; preserveInput?: boolean;
};

/** Original exercises. Platform problem statements and solutions are never copied. */
export const MISSIONS: Mission[] = [
  {
    id: "progress", title: "Ship a progress meter", category: "Foundations", level: "01", minutes: 15,
    brief: "Your first contribution to a learning platform: turn completed study hours into a percentage. A tiny function becomes a real product feature.",
    contract: "Implement progress(completed, goal). Return the whole-number percentage, rounded down and clamped to 0–100. Return 0 when goal ≤ 0. Inputs are integers.",
    intuition: "A function is a mathematical mapping with a precise contract. Here the range is the integers from 0 to 100; the boundary conditions are part of the definition.",
    starter: "def progress(completed, goal):\n    # Translate the contract into a small function.\n    return 0\n",
    functionName: "progress",
    hints: ["Start with the special case: if goal <= 0, return 0.", "Python // performs floor division. Compute completed * 100 // goal.", "Use max(0, min(100, value)) to keep a number inside the allowed range."],
    tests: [
      { label: "A quarter of the journey", args: [500, 2000], expected: 25, sample: true },
      { label: "Round down", args: [1, 3], expected: 33, sample: true },
      { label: "Empty goal", args: [5, 0], expected: 0 },
      { label: "Beyond the goal", args: [3000, 2000], expected: 100 },
      { label: "Negative completed hours", args: [-2, 10], expected: 0 },
      { label: "Negative goal", args: [10, -3], expected: 0 },
    ], resource: { label: "Python: numbers and control flow", url: "https://docs.python.org/3/tutorial/controlflow.html" },
    next: "Explain why you handled goal ≤ 0 before doing any division.",
  },
  {
    id: "study-streak", title: "Find the strongest study streak", category: "Loops", level: "02", minutes: 20,
    brief: "Build the activity feature for a learner dashboard. Each daily number is minutes of study; a positive number means an active day.",
    contract: "Implement longest_streak(minutes). Return the longest consecutive run of values greater than 0. An empty list returns 0. Values are integers.",
    intuition: "Maintain an invariant: current is the run ending at the latest day, and best is the largest run seen in the prefix processed so far.",
    starter: "def longest_streak(minutes):\n    current = 0\n    best = 0\n    # Process one day at a time.\n    return best\n", functionName: "longest_streak",
    hints: ["For each day, increase current if its value is positive; otherwise reset current to 0.", "After each day, update best = max(best, current).", "The list may end during the longest streak. Updating best inside the loop handles that."],
    tests: [
      { label: "Three days together", args: [[30, 0, 20, 45, 10, 0]], expected: 3, sample: true },
      { label: "No activity yet", args: [[]], expected: 0, sample: true },
      { label: "Streak ends on final day", args: [[0, 1, 1, 1, 1]], expected: 4 },
      { label: "No positive days", args: [[0, -1, 0]], expected: 0 },
      { label: "Several equal streaks", args: [[1, 1, 0, 1, 1]], expected: 2 },
    ], resource: { label: "Python: for statements", url: "https://docs.python.org/3/tutorial/controlflow.html#for-statements" },
    next: "Write down your loop invariant before moving to the next challenge.",
  },
  {
    id: "issue-labels", title: "Summarize an issue tracker", category: "Hash maps", level: "03", minutes: 25,
    brief: "Maintainers need a count of issue labels. Labels arrive with inconsistent whitespace and capitalization; normalize them before counting.",
    contract: "Implement label_counts(labels). Strip surrounding whitespace, convert to lowercase, ignore empty results, and return a dictionary of label → frequency. Inputs are strings.",
    intuition: "A dictionary implements a finite map. Counting a stream is repeated addition in each key's bucket, usually in expected O(n) time.",
    starter: "def label_counts(labels):\n    counts = {}\n    # Normalize each label before counting.\n    return counts\n", functionName: "label_counts",
    hints: ["Normalize with label.strip().lower().", "An empty string is false in a condition: if normalized:", "counts[key] = counts.get(key, 0) + 1 handles both new and existing keys."],
    tests: [
      { label: "Normalize before grouping", args: [[" Bug ", "bug", "Docs", " "]], expected: { bug: 2, docs: 1 }, sample: true },
      { label: "No issues", args: [[]], expected: {}, sample: true },
      { label: "Whitespace only", args: [["", "  ", "\t"]], expected: {} },
      { label: "Mixed labels", args: [["GOOD FIRST ISSUE", "docs", "Docs", "good first issue"]], expected: { "good first issue": 2, docs: 2 } },
    ], resource: { label: "Python: dictionaries", url: "https://docs.python.org/3/tutorial/datastructures.html#dictionaries" },
    next: "State the time and space cost in terms of label count and unique labels.",
  },
  {
    id: "queue", title: "Prioritize the review queue", category: "Sorting", level: "04", minutes: 25, preserveInput: true,
    brief: "Pull requests need a deterministic review order. Every record is [id, priority, age_hours]. Larger priority and older age come first; smaller id breaks ties.",
    contract: "Implement review_order(requests). Return a list of ids, sorted by descending priority, descending age, then ascending id. Do not modify the original list. IDs are distinct integers.",
    intuition: "A lexicographic ordering turns a multi-criterion decision into one comparison key. Negate the descending dimensions.",
    starter: "def review_order(requests):\n    # Build a key representing the order.\n    return []\n", functionName: "review_order",
    hints: ["Use sorted(requests, key=...) so the input remains unchanged.", "A key like (-item[1], -item[2], item[0]) encodes the three criteria.", "After sorting, keep only item[0] from each record."],
    tests: [
      { label: "Priority then age", args: [[[4, 2, 5], [7, 3, 1], [1, 2, 9]]], expected: [7, 1, 4], sample: true },
      { label: "An empty queue", args: [[]], expected: [], sample: true },
      { label: "Tie broken by ID", args: [[[9, 2, 5], [2, 2, 5], [4, 2, 5]]], expected: [2, 4, 9] },
      { label: "Priority wins over age", args: [[[1, 1, 999], [2, 2, 0]]], expected: [2, 1] },
    ], resource: { label: "Python sorting HOWTO", url: "https://docs.python.org/3/howto/sorting.html" },
    next: "Explain why the tuple key defines a total order for these records.",
  },
  {
    id: "first-bad", title: "Locate a slow release", category: "Binary search", level: "05", minutes: 35,
    brief: "A service's benchmark times are sorted in nondecreasing order. Find the first release whose time meets or exceeds an alert threshold.",
    contract: "Implement first_at_least(times, threshold). Return the first qualifying zero-based index, or len(times) when no value qualifies. Use O(log n) comparisons.",
    intuition: "The predicate times[i] ≥ threshold is monotone. Maintain a half-open interval [lo, hi) containing the first possible answer.",
    starter: "def first_at_least(times, threshold):\n    lo, hi = 0, len(times)\n    # Shrink [lo, hi) while preserving the answer.\n    return lo\n", functionName: "first_at_least",
    hints: ["While lo < hi, choose mid = (lo + hi) // 2.", "If times[mid] < threshold, the answer is after mid: lo = mid + 1.", "Otherwise preserve mid as a possible answer: hi = mid. Return lo."],
    tests: [
      { label: "First duplicate threshold", args: [[12, 20, 20, 35], 20], expected: 1, sample: true },
      { label: "No release qualifies", args: [[10, 20], 30], expected: 2, sample: true },
      { label: "Empty history", args: [[], 5], expected: 0 },
      { label: "All releases qualify", args: [[10, 20], 0], expected: 0 },
      { label: "Between values", args: [[1, 3, 5, 7, 9], 6], expected: 3 },
      { label: "One release", args: [[2], 2], expected: 0 },
    ], resource: { label: "Python bisect: insertion points", url: "https://docs.python.org/3/library/bisect.html" },
    next: "Tests check outputs; justify the O(log n) requirement yourself using interval size.",
  },
  {
    id: "brackets", title: "Check a configuration file", category: "Stacks", level: "06", minutes: 30,
    brief: "A configuration editor needs a small validation rule: brackets must close in reverse order. Ignore every character that is not a bracket.",
    contract: "Implement balanced(text). Return True when (), [], and {} are correctly nested and matched; return False otherwise. The empty string is balanced. Quotes have no special meaning in this exercise.",
    intuition: "The most recently opened scope must close first: this is last-in, first-out behavior, exactly what a stack models.",
    starter: "def balanced(text):\n    stack = []\n    # Match each closing bracket to the latest opener.\n    return not stack\n", functionName: "balanced",
    hints: ["Push opening brackets onto a list with append.", "For a closing bracket, require a nonempty stack and a matching opener at stack[-1].", "Pop when a pair matches. At the end, the stack must be empty."],
    tests: [
      { label: "Nested settings", args: ["a{b:[(c)]}"], expected: true, sample: true },
      { label: "Crossed pairs", args: ["([)]"], expected: false, sample: true },
      { label: "Unclosed opener", args: ["hello("], expected: false },
      { label: "Closing bracket first", args: [")("], expected: false },
      { label: "No brackets", args: [""], expected: true },
      { label: "Adjacent groups", args: ["{}[]()"], expected: true },
    ], resource: { label: "Python: using lists as stacks", url: "https://docs.python.org/3/tutorial/datastructures.html#using-lists-as-stacks" },
    next: "Construct a minimal counterexample to a solution that only counts open and closed brackets.",
  },
  {
    id: "pair-budget", title: "Pair jobs within a budget", category: "Two pointers", level: "07", minutes: 35,
    brief: "A compute scheduler pairs two different jobs. Count all unordered pairs whose combined cost does not exceed the budget. Repeated costs still represent different jobs.",
    contract: "Implement count_pairs(costs, budget). Return the number of index pairs i < j with costs[i] + costs[j] ≤ budget. Costs and budget are nonnegative integers. Aim for O(n log n) time.",
    intuition: "Once costs are sorted, a feasible pair with the largest endpoint certifies a whole interval of feasible partners for the smallest endpoint.",
    starter: "def count_pairs(costs, budget):\n    values = sorted(costs)\n    left, right = 0, len(values) - 1\n    count = 0\n    return count\n", functionName: "count_pairs",
    hints: ["Compare values[left] + values[right] with the budget.", "If the sum fits, every index between left+1 and right fits with left: add right - left, then increase left.", "If the sum is too large, decrease right. Stop when left >= right."],
    tests: [
      { label: "Four affordable pairs", args: [[1, 2, 3, 4], 5], expected: 4, sample: true },
      { label: "Only one job", args: [[1], 2], expected: 0, sample: true },
      { label: "Repeated costs are distinct jobs", args: [[2, 2, 2, 2], 4], expected: 6 },
      { label: "Nothing fits", args: [[9, 10, 11], 5], expected: 0 },
      { label: "Zero-cost jobs", args: [[0, 0, 0], 0], expected: 3 },
      { label: "No jobs", args: [[], 10], expected: 0 },
    ], resource: { label: "Python sorting HOWTO", url: "https://docs.python.org/3/howto/sorting.html" },
    next: "Explain why adding right - left counts each pair exactly once.",
  },
  {
    id: "outages", title: "Combine incident windows", category: "Intervals", level: "08", minutes: 35,
    brief: "Your status page receives overlapping incident reports. Combine them into a clean list of outage windows.",
    contract: "Implement merge_windows(windows). Each [start, end] has integer start ≤ end. Return sorted, disjoint merged windows. Windows that touch, such as [1,3] and [3,5], must merge.",
    intuition: "Sorting by start lets you prove that only the last merged interval can overlap the next one. That removes the need for pairwise comparison.",
    starter: "def merge_windows(windows):\n    result = []\n    # Sort, then grow the current interval or start another.\n    return result\n", functionName: "merge_windows",
    hints: ["Iterate through sorted(windows).", "If result is empty or start > result[-1][1], append a new [start, end].", "Otherwise extend the last end to max(result[-1][1], end)."],
    tests: [
      { label: "Overlapping incidents", args: [[[5, 8], [1, 4], [3, 6], [10, 12]]], expected: [[1, 8], [10, 12]], sample: true },
      { label: "Touching windows", args: [[[1, 3], [3, 5]]], expected: [[1, 5]], sample: true },
      { label: "Nested report", args: [[[1, 10], [2, 3]]], expected: [[1, 10]] },
      { label: "No incidents", args: [[]], expected: [] },
      { label: "Point windows", args: [[[2, 2], [1, 1], [2, 2]]], expected: [[1, 1], [2, 2]] },
    ], resource: { label: "Python: sequence types", url: "https://docs.python.org/3/library/stdtypes.html#sequence-types-list-tuple-range" },
    next: "Compare the O(n log n) sorting step with the O(n) scan.",
  },
  {
    id: "network", title: "Route a service request", category: "Graphs", level: "09", minutes: 45,
    brief: "Model services as a directed graph: graph[name] lists the services reachable in one hop. Find the fewest hops from a source to a target.",
    contract: "Implement shortest_hops(graph, start, target). Return the shortest directed path length, or -1 if unreachable. Every node is a string. Missing adjacency entries have no outgoing edges. start == target returns 0.",
    intuition: "Breadth-first search explores distance layers. When a node is first discovered, all shorter paths have already been explored.",
    starter: "from collections import deque\n\ndef shortest_hops(graph, start, target):\n    queue = deque([(start, 0)])\n    visited = {start}\n    # Explore one distance layer at a time.\n    return -1\n", functionName: "shortest_hops",
    hints: ["Pop a (node, distance) pair from the left of the queue.", "Return distance when node == target. Use graph.get(node, []) for neighbors.", "Mark a neighbor visited when you enqueue it, preventing repeated work on cycles."],
    tests: [
      { label: "Two-hop route", args: [{ web: ["api"], api: ["db"], db: [] }, "web", "db"], expected: 2, sample: true },
      { label: "Already there", args: [{}, "web", "web"], expected: 0, sample: true },
      { label: "Directed edges", args: [{ a: ["b"], b: [] }, "b", "a"], expected: -1 },
      { label: "Cycle and shortcut", args: [{ a: ["b", "d"], b: ["a", "c"], c: ["d"], d: ["e"] }, "a", "e"], expected: 2 },
      { label: "Unreachable target", args: [{ a: ["b"], b: ["a"] }, "a", "z"], expected: -1 },
    ], resource: { label: "Python collections.deque", url: "https://docs.python.org/3/library/collections.html#collections.deque" },
    next: "Prove the O(V + E) bound and explain why a stack would not guarantee the shortest route.",
  },
  {
    id: "release-plan", title: "Plan a release pipeline", category: "DAGs", level: "10", minutes: 50,
    brief: "Build jobs depend on other jobs. Produce a valid execution order, choosing the lexicographically smallest available job at each step.",
    contract: "Implement build_order(deps). deps maps every job name to its prerequisite names; all prerequisites are keys too. Return the deterministic order described above, or [] if a dependency cycle exists. Names are strings; prerequisite lists have no duplicates.",
    intuition: "A topological order is a linear extension of a partial order. Repeatedly remove a vertex with zero indegree; a min-heap makes the tie rule efficient.",
    starter: "import heapq\n\ndef build_order(deps):\n    # Track indegrees and reverse edges.\n    return []\n", functionName: "build_order",
    hints: ["Set indegree[job] = len(prerequisites), and build edges from prerequisite to dependent jobs.", "Put every zero-indegree name into a heap. Pop the smallest, append it, and decrement its dependents' indegrees.", "If the result contains fewer jobs than deps, a cycle prevented the rest from becoming available."],
    tests: [
      { label: "A build pipeline", args: [{ test: ["build"], deploy: ["test"], build: [] }], expected: ["build", "test", "deploy"], sample: true },
      { label: "A cycle", args: [{ a: ["b"], b: ["a"] }], expected: [], sample: true },
      { label: "Tie order is deterministic", args: [{ z: [], a: [], m: ["a"] }], expected: ["a", "m", "z"] },
      { label: "Multiple prerequisites", args: [{ ship: ["lint", "test"], test: ["build"], lint: [], build: [] }], expected: ["build", "lint", "test", "ship"] },
      { label: "No jobs", args: [{}], expected: [] },
    ], resource: { label: "Python heapq", url: "https://docs.python.org/3/library/heapq.html" },
    next: "Explain how the processed-count check detects a cycle even when part of the graph is acyclic.",
  },
  {
    id: "test-engineer", title: "Repair a boundary bug", category: "Testing", level: "11", minutes: 40,
    brief: "A team shipped a binary-search helper with a subtle contract mismatch. It returns some matching position, but the API requires the first. Repair the implementation and use boundary cases to verify it.",
    contract: "Implement first_match(values, target). values is a sorted integer list. Return the first index equal to target, or -1 if missing. Preserve O(log n) time.",
    intuition: "A test is an executable claim about the contract. Duplicates, empty input, and the endpoints distinguish an implementation that seems right from one that satisfies the specification.",
    starter: "def first_match(values, target):\n    left, right = 0, len(values) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if values[mid] == target:\n            return mid  # Does this satisfy the full contract?\n        if values[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1\n", functionName: "first_match",
    hints: ["A match proves existence, but an earlier match may still exist to its left.", "Save mid as a candidate and continue searching the left half.", "Initialize answer = -1. On a match set answer = mid and right = mid - 1. Return answer after the loop."],
    tests: [
      { label: "Duplicates reveal the defect", args: [[1, 2, 2, 2, 4], 2], expected: 1, sample: true },
      { label: "Missing value", args: [[1, 3, 5], 2], expected: -1, sample: true },
      { label: "Empty list", args: [[], 1], expected: -1 },
      { label: "All values equal", args: [[7, 7, 7, 7, 7], 7], expected: 0 },
      { label: "Last index", args: [[1, 2, 3], 3], expected: 2 },
      { label: "One match", args: [[9], 9], expected: 0 },
    ], resource: { label: "Python unittest", url: "https://docs.python.org/3/library/unittest.html" },
    next: "Create your own regression test locally, then turn this fix into a small pull request with an explanation.",
  },
  {
    id: "capacity", title: "Optimize a training budget", category: "Dynamic programming", level: "12", minutes: 60,
    brief: "Choose practice modules under a time budget. Module i takes hours[i] hours and gives values[i] learning points. You may select each module at most once.",
    contract: "Implement best_plan(hours, values, budget). Return the maximum total value with total hours ≤ budget. Hours are positive integers; values and budget are nonnegative integers; lists have equal lengths. Aim for O(n × budget) time and O(budget) space.",
    intuition: "Define dp[b] as the best value achievable with capacity b using modules seen so far. Descending capacity updates preserve the at-most-once constraint.",
    starter: "def best_plan(hours, values, budget):\n    dp = [0] * (budget + 1)\n    # Decide whether to include each module.\n    return dp[budget]\n", functionName: "best_plan",
    hints: ["For each (cost, value), consider capacities from budget down to cost.", "dp[b] = max(dp[b], dp[b - cost] + value).", "An ascending loop would allow the current module to be reused. The reverse loop is essential."],
    tests: [
      { label: "Choose a combination", args: [[2, 3, 4], [4, 5, 7], 5], expected: 9, sample: true },
      { label: "No time available", args: [[1], [10], 0], expected: 0, sample: true },
      { label: "Each module once", args: [[2], [3], 6], expected: 3 },
      { label: "Nothing fits", args: [[5, 7], [10, 20], 3], expected: 0 },
      { label: "No modules", args: [[], [], 10], expected: 0 },
      { label: "Greedy by value fails", args: [[4, 3, 3], [7, 6, 6], 6], expected: 12 },
    ], resource: { label: "MIT: algorithms course materials", url: "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/" },
    next: "Prove the recurrence, reconstruct an optimal chosen set, then compare with an exhaustive solver on small random inputs.",
  },
];

export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (typeof a !== typeof b || a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  if (typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && jsonEqual(a[key], b[key]));
  }
  return a === b;
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10000 && value.every(item => isJsonValue(item, depth + 1));
  return typeof value === "object" && value !== null && Object.keys(value).length <= 10000 && Object.values(value).every(item => isJsonValue(item, depth + 1));
}
