#!/usr/bin/env python3
"""Tests for the path-glob sub-context layer in resolve_context.py.

Run: python3 -m unittest skills/saboteur-pos/scripts/test_resolve_context.py
(or just `python3 test_resolve_context.py` from this directory).
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "resolve_context.py"

spec = importlib.util.spec_from_file_location("resolve_context", SCRIPT)
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)


class GlobMatching(unittest.TestCase):
    def test_star_stays_in_segment(self):
        self.assertTrue(rc.path_matches("apps/*", "apps/web"))
        self.assertFalse(rc.path_matches("apps/*", "apps/web/src"))

    def test_doublestar_spans_segments(self):
        self.assertTrue(rc.path_matches("apps/web/**", "apps/web/src/index.ts"))
        self.assertTrue(rc.path_matches("apps/web/**", "apps/web/src"))

    def test_dir_glob_matches_dir_itself(self):
        # `apps/web/**` should match the directory `apps/web`, not just contents.
        self.assertTrue(rc.path_matches("apps/web/**", "apps/web"))

    def test_no_match_on_sibling(self):
        self.assertFalse(rc.path_matches("apps/web/**", "apps/api"))
        self.assertFalse(rc.path_matches("apps/web/**", "apps"))

    def test_leading_doublestar_slash_matches_zero_dirs(self):
        self.assertTrue(rc.path_matches("**/node_modules/**", "node_modules/x"))
        self.assertTrue(rc.path_matches("**/node_modules/**", "a/b/node_modules/x"))

    def test_whole_repo_glob(self):
        self.assertTrue(rc.path_matches("**", "."))
        self.assertTrue(rc.path_matches("**", "anything/at/all"))

    def test_question_mark(self):
        self.assertTrue(rc.path_matches("v?", "v1"))
        self.assertFalse(rc.path_matches("v?", "v1/x"))


class LookupSlug(unittest.TestCase):
    def make(self, value):
        return {"version": 2, "mappings": {"k": value}}

    def test_bare_string_ignores_path(self):
        slug, rule = rc.lookup_slug(self.make("whole-repo"), "k", "apps/web")
        self.assertEqual(slug, "whole-repo")
        self.assertIsNone(rule)

    def test_unknown_key(self):
        self.assertEqual(rc.lookup_slug(self.make("x"), "other", "."), (None, None))

    def test_first_match_wins(self):
        entry = {
            "default": "misc",
            "paths": [
                {"glob": "apps/**", "context": "broad"},
                {"glob": "apps/web/**", "context": "web"},
            ],
        }
        # Ordered: the broad rule is listed first, so it shadows the specific one.
        slug, rule = rc.lookup_slug(self.make(entry), "k", "apps/web/src")
        self.assertEqual(slug, "broad")
        self.assertEqual(rule, "apps/** -> broad")

    def test_specific_when_ordered_first(self):
        entry = {
            "default": "misc",
            "paths": [
                {"glob": "apps/web/**", "context": "web"},
                {"glob": "apps/**", "context": "broad"},
            ],
        }
        self.assertEqual(rc.lookup_slug(self.make(entry), "k", "apps/web/x")[0], "web")
        self.assertEqual(rc.lookup_slug(self.make(entry), "k", "apps/api/x")[0], "broad")

    def test_falls_back_to_default(self):
        entry = {"default": "misc", "paths": [{"glob": "infra/**", "context": "infra"}]}
        slug, rule = rc.lookup_slug(self.make(entry), "k", "docs")
        self.assertEqual(slug, "misc")
        self.assertEqual(rule, "default")

    def test_root_falls_to_default(self):
        entry = {"default": "misc", "paths": [{"glob": "apps/web/**", "context": "web"}]}
        self.assertEqual(rc.lookup_slug(self.make(entry), "k", ".")[0], "misc")

    def test_no_default_no_match_is_unmapped(self):
        entry = {"paths": [{"glob": "apps/web/**", "context": "web"}]}
        self.assertEqual(rc.lookup_slug(self.make(entry), "k", "docs"), (None, None))


class IntegrationFixtureMonorepo(unittest.TestCase):
    """Drive the script end-to-end against a real temp git repo + custom map."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        # A repo with no remote -> keyed by its absolute root path.
        for cmd in (["git", "init", "-q"], ["git", "config", "user.email", "t@t"]):
            subprocess.run(cmd, cwd=self.root, check=True)
        (self.root / "apps/web").mkdir(parents=True)
        (self.root / "apps/api").mkdir(parents=True)
        (self.root / "infra").mkdir()

        self.map_path = self.root / "context-map.json"
        self.map_path.write_text(
            json.dumps(
                {
                    "version": 2,
                    "mappings": {
                        str(self.root): {
                            "default": "platform-misc",
                            "paths": [
                                {"glob": "apps/web/**", "context": "platform-web"},
                                {"glob": "apps/api/**", "context": "platform-api"},
                                {"glob": "infra/**", "context": "platform-infra"},
                            ],
                        }
                    },
                }
            )
        )

    def tearDown(self):
        self.tmp.cleanup()

    def slug_from(self, subdir):
        env = dict(os.environ, SABOTEUR_CONTEXT_MAP=str(self.map_path))
        p = subprocess.run(
            [sys.executable, str(SCRIPT), "slug"],
            cwd=self.root / subdir,
            env=env,
            capture_output=True,
            text=True,
        )
        return p.returncode, p.stdout.strip()

    def test_subtree_resolves_to_subcontext(self):
        self.assertEqual(self.slug_from("apps/web"), (0, "platform-web"))
        self.assertEqual(self.slug_from("apps/api"), (0, "platform-api"))
        self.assertEqual(self.slug_from("infra"), (0, "platform-infra"))

    def test_nested_subtree_still_resolves(self):
        (self.root / "apps/web/src/components").mkdir(parents=True)
        self.assertEqual(
            self.slug_from("apps/web/src/components"), (0, "platform-web")
        )

    def test_root_falls_to_default(self):
        self.assertEqual(self.slug_from("."), (0, "platform-misc"))

    def test_unmatched_subtree_falls_to_default(self):
        (self.root / "docs").mkdir()
        self.assertEqual(self.slug_from("docs"), (0, "platform-misc"))


if __name__ == "__main__":
    unittest.main()
