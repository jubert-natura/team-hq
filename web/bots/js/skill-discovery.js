// Discovery starter adapted for Team Bot's instruction editor. No CLI is installed or executed.
export const SKILLS_CATALOG_URL = 'https://skills.sh/';
export const FIND_SKILLS_SOURCE_URL = 'https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md';
export const FIND_SKILLS_STARTER = {
  name: 'Find skills',
  trigger: 'When a task needs a capability that is missing from this bot’s enabled skills',
  instructions: 'Identify the bot’s task and missing capability. Search skills.sh for relevant skills. Inspect each candidate’s SKILL.md, supporting files, dependencies and license. Present suitable options with their source links and required tools. Recommend a small test. Get owner approval before adding or updating an executable package. Record the approved source/version. If none fits, propose a custom skill. This discovery procedure requires a runtime with browsing or an approved skills CLI; a saved instruction alone cannot search.',
  reference_url: FIND_SKILLS_SOURCE_URL,
  // Saved with the skill. It needs browsing, which the text-only runtime lacks, so the skill starts off.
  source: {
    url: FIND_SKILLS_SOURCE_URL, revision: '', license: 'MIT', files: ['SKILL.md'],
    required_tools: ['Web browsing or an approved skills CLI'], adaptation: 'instructions',
    test: 'Name a missing capability for a real task. Check that it returns candidate links with licenses, required tools and a small test, and installs nothing.',
    compatibility: 'needs_tools'
  }
};
