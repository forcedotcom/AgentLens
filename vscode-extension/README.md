# AgentLens

Understand what your Agentforce agent actually did — visually, inside VS Code.

![AgentLens](https://raw.githubusercontent.com/msrivastav13/AgentLens/main/images/output.png)

## Features

### Agent Graph

See which sub-agents communicated, how many times, and in what order. Instantly spot handoff loops and unexpected routing.

### Finite State Machine Diagram

Visualize the internal orchestration flow for each sub-agent: LLM calls, tool executions, variable mutations, and handoffs rendered as an interactive FSM.

### Step-by-Step Inspector

Walk through every event with full detail — system prompts, model output, tool inputs/outputs, and variable diffs. Navigate with arrow keys or prev/next buttons; handoffs auto-navigate to the next agent.

### Filter Controls

Toggle visibility of variable updates, reasoning steps, node entry state, enabled tools, and internal system variables to focus on what matters.

### Native Theme Integration

Adapts to your VS Code color theme (light, dark, high-contrast) automatically.

## Usage

### Open a Trace File

- **Right-click** any `.json` file in the Explorer and select **Open with AgentLens**
- **Right-click** inside an open JSON editor and select **Open with AgentLens**
- Run the command **AgentLens: Open Trace** from the Command Palette (`Cmd+Shift+P`)

### CodeLens Integration

Trace files stored at `.sfdx/agents/**/traces/*.json` (created by the SF CLI or Agentforce DX extension) show an inline **Open in AgentLens** button at the top of the file.

### Paste or Upload

Open AgentLens without a file and paste JSON directly, upload a file, or drag-and-drop a trace into the panel.

## Getting a Trace

AgentLens accepts trace JSON from any of these sources:

| Source | How to get the trace |
|--------|---------------------|
| **SF CLI — Agent Preview** | `sf agent preview -o <org>` — after the conversation, the transcript JSON is saved to `.sfdx/agents/` in your project |
| **Agentforce DX Extension** | Use the trace viewer in the Agentforce DX VS Code extension and copy the plan response JSON |
| **Agentforce Builder** | Open your agent in Setup > Agentforce Builder, run a conversation in the Preview panel, then copy the JSON trace from the conversation details |

## Requirements

- VS Code 1.95.0 or later
- No additional dependencies

## Extension Settings

This extension does not add any VS Code settings. It activates automatically when you open a JSON file.

## Known Issues

- Files larger than 50 MB are rejected to keep the editor responsive.

## Release Notes

### 0.3.0

- Agent Graph visualization with sub-agent communication paths
- Finite State Machine diagram per sub-agent
- Step-by-step inspector with keyboard navigation
- Filter toolbar for variable updates, reasoning, node entry, enabled tools, and internal vars
- CodeLens integration for `.sfdx/agents/**/traces/*.json`
- Custom editor and context menu integration
- Native VS Code theme support (light, dark, high-contrast)
- Paste, upload, and drag-and-drop trace loading

## License

[MIT](https://github.com/msrivastav13/AgentLens/blob/main/LICENSE)
