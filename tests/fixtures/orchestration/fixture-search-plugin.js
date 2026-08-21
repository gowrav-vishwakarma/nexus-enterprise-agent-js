/** Test tool plugin for orchestration manifest loading. */

import { defineTool, defineToolPlugin } from "../../../src/tools/decorators.js";

export class FixtureSearchPlugin {
  search = defineTool(
    function search(query) {
      return `fixture result for ${query}`;
    },
    { name: "search", description: "Search fixture index." },
  );
}

defineToolPlugin("fixture_search")(FixtureSearchPlugin);
