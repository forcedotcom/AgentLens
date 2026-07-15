# AgentLens

Understand what your Agentforce agent actually did — visually.

📝 **Blog:** [AgentLens: Debug Agentforce with Interactive Visualizations](https://developer.salesforce.com/blogs/2026/05/agentlens-debug-agentforce-with-interactive-visualizations)

![AgentLens](images/output.png)

## Watch the Demo

[![AgentLens demo video](https://img.youtube.com/vi/TZxVNKrx4mU/maxresdefault.jpg)](https://www.youtube.com/watch?v=TZxVNKrx4mU)

## What it does

Load a trace from the **Agentforce DX** extension, the **NGA builder**, or the **SF CLI** and AgentLens shows you:

- **Agent Graph** — which sub agents talked to each other, how many times, and in what order
- **Finite State Machine** — the internal orchestration flow for each sub agent: LLM calls, tool executions, variable mutations, and handoffs
- **Step-by-Step Inspector** — walk through every event with full detail: system prompts, model output, tool inputs/outputs, and variable diffs
- **Graph Analysis Report** — one-click PDF with degree distribution, connectivity analysis, betweenness centrality, and algorithm explanations

## Getting a Trace

AgentLens accepts trace JSON from any of these sources:

| Source | How to get the trace |
|--------|---------------------|
| **Agentforce Builder** | Open your agent in Setup > Agentforce Builder, run a conversation in the Preview panel, then copy the JSON trace from the conversation details |
| **SF CLI — Agent Preview** | `sf agent preview -o <org>` — after the conversation, save the transcript JSON (saved to `./temp/agent-preview` by default, or specify `--output-dir`) |
| **Agentforce DX Extension** | Use the trace viewer in the Agentforce DX VS Code extension and copy the plan response JSON |

## Quick Start

### Chrome Extension

**Install from the Chrome Web Store:** [AgentLens](https://chromewebstore.google.com/detail/agentlens/gnlkpnbodhkjaamddkbhgobkgepnjgpa)

Once installed:

1. Navigate to the NGA builder in your Salesforce org
2. Click **Copy Code** to copy the trace, then click the **Open in AgentLens** button that appears next to it
3. A new tab opens with the full trace visualization

The extension injects a button directly into the NGA builder UI for one-click trace viewing.

**Install from source (for development):**

1. Open `chrome://extensions` and enable **Developer mode**
2. Click **Load unpacked** and select the `chrome-extension/` folder

### VS Code Extension

**Install from the Marketplace:** [AgentLens Visualizer](https://marketplace.visualstudio.com/items?itemName=MohithShrivastava.agentlens-viewer)

Or search for **AgentLens Visualizer** in the VS Code Extensions panel (`Cmd+Shift+X`).

The extension provides the same visualization inside VS Code with native theme integration — right-click any trace JSON file and select **Open with AgentLens**.

## Why

Agentforce traces are large JSON blobs. Reading them raw is painful. AgentLens turns them into something you can actually navigate — so you can debug handoff loops, understand why an LLM chose a tool, or figure out where latency is hiding.

Zero dependencies. Runs entirely in the browser. Works offline. Available as a web app, Chrome extension, and VS Code extension.

## License

Apache License 2.0 — Copyright (c) 2026 Salesforce, Inc. See [LICENSE.txt](LICENSE.txt).
