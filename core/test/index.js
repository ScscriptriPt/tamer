// Node 24's test runner does not expand a directory argument on this build, so
// `node --test core/test` loads this entry and the imports below register all
// test files. Each file still works on its own with `node --test path/to/test.ts`.
import './dates.test.ts';
import './rules.test.ts';
import './plan.test.ts';
import './render.test.ts';
import './store.test.ts';
import './breakpoint.test.ts';
import './ideas.test.ts';
import './cli.test.ts';
import './init.test.ts';
