"""Execute the curriculum's Python teaching examples, using only the standard library.

Run: python3 tests/curriculum_examples.py public/curriculum.json
The Hypothesis example's property body is checked independently; this does not
claim to validate the installed Hypothesis package or its test runner.
"""

import ast
from collections import Counter, deque
from contextlib import redirect_stdout
from io import StringIO
import itertools
import json
import os
from pathlib import Path
import random
import sys
from tempfile import TemporaryDirectory
import unittest


data_path = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "public/curriculum.json"
data = json.loads(data_path.read_text(encoding="utf-8"))
examples = {
    module["id"]: example
    for phase in data["phases"]
    for module in phase["modules"]
    for example in module["codeExamples"]
    if example["language"] == "python"
}


def execute(module_id, context=None):
    scope = dict(context or {})
    output = StringIO()
    with redirect_stdout(output):
        exec(compile(examples[module_id]["code"], f"curriculum:{module_id}", "exec"), scope)
    return scope, output.getvalue()


class CurriculumExamples(unittest.TestCase):
    def test_all_python_examples_have_valid_syntax(self):
        self.assertEqual(len(examples), 12)
        for identifier, example in examples.items():
            with self.subTest(module=identifier):
                ast.parse(example["code"])

    def test_hello_world(self):
        _, output = execute("f01")
        self.assertEqual(output, "Hello, builder\n")

    def test_minutes_boundaries_and_identity_assertions(self):
        scope, output = execute("f03")
        self.assertEqual(output, "2 5\n")
        split = scope["split_minutes"]
        for minutes in [0, 1, 59, 60, 61, 125, 1000, 10**30]:
            hours, remainder = split(minutes)
            self.assertEqual(60 * hours + remainder, minutes)
            self.assertTrue(0 <= remainder < 60)
        with self.assertRaises(ValueError):
            split(-1)
        execute("f04", {"split_minutes": split})

    def test_sum_and_pytest_examples(self):
        scope, _ = execute("p02")
        total = scope["total_minutes"]
        self.assertEqual(total([]), 0)
        self.assertEqual(total([0, 5, 0, 12]), 17)
        self.assertEqual(total([10**30, 10**30]), 2 * 10**30)
        tests, _ = execute("p05", {"total_minutes": total})
        tests["test_total_minutes_includes_every_session"]()
        tests["test_total_minutes_empty_history"]()

    def test_frequency_collection_example(self):
        scope, _ = execute("p03")
        self.assertEqual(scope["counts"], {"graph": 2, "dp": 1})

    def test_json_roundtrip_in_an_isolated_temp_directory(self):
        original = Path.cwd()
        with TemporaryDirectory(prefix="forge-json-example-") as directory:
            try:
                os.chdir(directory)
                scope, _ = execute("p04")
                self.assertEqual(scope["sessions"], [15, 30])
                self.assertEqual(json.loads(Path("sessions.json").read_text()), [15, 30])
            finally:
                os.chdir(original)

    def test_prefix_sums_against_every_range(self):
        scope, _ = execute("d02")
        prefix = scope["prefix_sums"]
        for size in range(5):
            for values in itertools.product([-2, 0, 3], repeat=size):
                result = prefix(values)
                self.assertEqual(result[0], 0)
                for left in range(size + 1):
                    for right in range(left, size + 1):
                        self.assertEqual(result[right] - result[left], sum(values[left:right]))

    def test_binary_search_against_linear_oracle(self):
        scope, _ = execute("d03")
        lower_bound = scope["first_at_least"]
        randomizer = random.Random(618)
        for _ in range(1500):
            values = sorted(randomizer.randrange(-10, 11) for _ in range(randomizer.randrange(30)))
            target = randomizer.randrange(-12, 13)
            expected = next((index for index, value in enumerate(values) if value >= target), len(values))
            self.assertEqual(lower_bound(values, target), expected)

    def test_bfs_against_repeated_edge_relaxation(self):
        scope, _ = execute("a02")
        bfs = scope["distances"]
        randomizer = random.Random(381)
        for _ in range(200):
            size = randomizer.randrange(1, 12)
            graph = {vertex: [other for other in range(size) if randomizer.random() < 0.2] for vertex in range(size)}
            expected = {0: 0}
            for _ in range(size - 1):
                previous = dict(expected)
                for vertex, distance in previous.items():
                    for neighbor in graph[vertex]:
                        expected[neighbor] = min(expected.get(neighbor, size + 1), distance + 1)
            self.assertEqual(bfs(graph, 0), expected)
        self.assertEqual(bfs({}, "isolated"), {"isolated": 0})

    def test_dynamic_programming_against_state_search(self):
        scope, _ = execute("a04")
        minimum = scope["min_sessions"]

        def oracle(total, sizes):
            queue = deque([(0, 0)])
            seen = {0}
            while queue:
                amount, count = queue.popleft()
                if amount == total:
                    return count
                for size in sizes:
                    next_amount = amount + size
                    if next_amount <= total and next_amount not in seen:
                        seen.add(next_amount)
                        queue.append((next_amount, count + 1))
            return None

        for mask in range(1, 32):
            sizes = [value for value in range(1, 6) if mask & (1 << (value - 1))]
            for total in range(25):
                self.assertEqual(minimum(total, sizes), oracle(total, sizes))
        self.assertIsNone(minimum(3, []))
        self.assertEqual(minimum(0, []), 0)

    def test_hypothesis_property_body_independently(self):
        tree = ast.parse(examples["q02"]["code"])
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
        function.decorator_list = []
        body = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
        scope = {"Counter": Counter}
        exec(compile(body, "curriculum:q02:property-body", "exec"), scope)
        check = scope["test_sort_preserves_values"]
        randomizer = random.Random(22)
        for values in [[], [0], [5, 5, 5], [4, 2, -3], [10**40, -(10**40)]]:
            check(values)
        for _ in range(1000):
            check([randomizer.randrange(-100, 101) for _ in range(randomizer.randrange(40))])


if __name__ == "__main__":
    print("12 Python snippets parsed; behavioral checks use deterministic oracles and isolated files.")
    unittest.main(verbosity=2)
