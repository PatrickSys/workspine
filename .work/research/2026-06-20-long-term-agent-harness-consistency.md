# Research Grounding: Long-Term Agent Harness Consistency

Date: 2026-06-20
Scope: `gsdd next`, `.work`, continuity graph, decision gates, verification/audit/gap-fix loop

## Research Question

What does Workspine need to do to keep long-running agentic product work coherent over time?

## Sources Reviewed

### Current Tooling and Harness References

- OpenAI, "Build an Agent Improvement Loop with Traces, Evals, and Codex"  
  https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop

- OpenAI, "Evaluate agent workflows"  
  https://developers.openai.com/api/docs/guides/agent-evals

- OpenAI, "Guardrails and human review"  
  https://developers.openai.com/api/docs/guides/agents/guardrails-approvals

- OpenAI, "Build iterative repair loops with Codex"  
  https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex

- Anthropic, "Building effective agents"  
  https://www.anthropic.com/engineering/building-effective-agents

- LangGraph, "Interrupts"  
  https://docs.langchain.com/oss/python/langgraph/interrupts

- Temporal, "Workflow Definition"  
  https://docs.temporal.io/workflow-definition

- Inspect AI, UK AI Security Institute evaluation framework  
  https://inspect.aisi.org.uk/

- LangSmith, "Evaluation concepts"  
  https://docs.langchain.com/langsmith/evaluation-concepts

- OpenTelemetry, "Generative AI semantic conventions"  
  https://opentelemetry.io/docs/specs/semconv/gen-ai/

### Agent Benchmark and Evaluation Papers

- SWE-bench: Can Language Models Resolve Real-World GitHub Issues?  
  https://arxiv.org/abs/2310.06770

- SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering  
  https://arxiv.org/abs/2405.15793

- AgentBench: Evaluating LLMs as Agents  
  https://arxiv.org/abs/2308.03688

- WebArena: A Realistic Web Environment for Building Autonomous Agents  
  https://arxiv.org/abs/2307.13854

- OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments  
  https://arxiv.org/abs/2404.07972

- tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains  
  https://arxiv.org/abs/2406.12045

### Memory, Reflection, and Self-Improvement Papers

- ReAct: Synergizing Reasoning and Acting in Language Models  
  https://arxiv.org/abs/2210.03629

- Reflexion: Language Agents with Verbal Reinforcement Learning  
  https://arxiv.org/abs/2303.11366

- Generative Agents: Interactive Simulacra of Human Behavior  
  https://arxiv.org/abs/2304.03442

- Voyager: An Open-Ended Embodied Agent with Large Language Models  
  https://arxiv.org/abs/2305.16291

- ReST meets ReAct: Self-Improvement for Multi-Step Reasoning LLM Agent  
  https://arxiv.org/abs/2312.10003

### 2026 Agent Security and Trust Papers

- Agent-Fence: Mapping Security Vulnerabilities Across Deep Research Agents  
  https://arxiv.org/abs/2602.07652

- AgentWard: A Lifecycle Security Architecture for Autonomous AI Agents  
  https://arxiv.org/abs/2604.24657

- AgentTrust: Runtime Safety Evaluation and Interception for AI Agent Tool Use  
  https://arxiv.org/abs/2605.04785

- AgentTrust: A Self-Improving Trust Layer for AI-Agent Actions  
  https://arxiv.org/abs/2606.08539

## Synthesis

### 1. The harness is the product surface

OpenAI frames an agent harness as the full contract around the model: instructions, tools, routing, output requirements, validation, feedback, evals, and implementation handoff. Workspine should adopt this framing. `gsdd next` is not a convenience command; it is the harness router that keeps the contract coherent.

Implication for Workspine:

- `.work` must store harness state, not just prose context.
- `gsdd next` must reason from durable artifacts, not chat memory.
- Every continuation should produce a next-action packet that can be inspected and replayed.

### 2. Durable interrupts are the right human-gate model

LangGraph's interrupt pattern pauses execution, persists graph state, surfaces a JSON-serializable question, and resumes with the answer. Temporal's workflow model reinforces durable, deterministic state as the backbone of long-running work.

Implication for Workspine:

- Questions must be persisted as first-class graph nodes.
- The agent should stop at decision gates with a durable question packet.
- Resuming should consume an answer and update graph state, not rely on chat scrollback.

### 3. Review and repair must be separate phases

OpenAI's Codex repair-loop example separates structured review findings from repair. This is the right shape for Workspine audit/gap-fix. The reviewer/auditor should not silently fix while judging, and the repair pass should consume machine-readable findings.

Implication for Workspine:

- `verify` and `audit` should emit structured findings.
- `fix_gaps` should consume those findings.
- `gsdd next` should route between them explicitly.

### 4. Evaluation needs datasets, solvers, scorers, traces, and human feedback

Inspect and LangSmith both separate inputs/datasets, agent/solver execution, scorers/evaluators, traces, and feedback. LangSmith distinguishes offline evaluation from online monitoring and emphasizes converting production traces and human feedback into datasets.

Implication for Workspine:

- Add fixture-state evals for `gsdd next`.
- Treat `.work/graph/events.jsonl` as raw trace material.
- Treat dogfood findings as human feedback that can become regression tests.
- Do not treat one successful manual run as enough evidence.

### 5. Agent-computer interface quality changes agent performance

SWE-agent and Anthropic's agent engineering guidance converge on the same point: agents need a thoughtfully designed interface. Tool names, tool docs, path handling, completion signals, and environmental feedback matter.

Implication for Workspine:

- `gsdd next --json` must be stable and easy for agents to consume.
- Tool/CLI outputs should avoid ambiguity.
- Commands should include enough machine-readable structure for follow-on agents.
- Absolute or repo-root-relative paths should be preferred in packets.

### 6. Long-horizon failure is expected

AgentBench, WebArena, OSWorld, tau-bench, and SWE-bench all show that realistic interactive tasks expose failures in long-term reasoning, planning, instruction following, environment interaction, and task completion. Workspine should assume agents drift unless the harness actively constrains and measures the work.

Implication for Workspine:

- `gsdd next` should never imply unbounded autonomy.
- State transitions must be explicit.
- Completion must be evidence-backed.
- Long-running work needs periodic consolidation and stop conditions.

### 7. Memory must be distilled, scoped, and falsifiable

ReAct, Reflexion, Generative Agents, Voyager, and ReST-meets-ReAct all support the idea that agents improve when they can reflect, remember useful lessons, and reuse skills. They do not justify dumping raw transcripts into state. Workspine needs distilled, typed memory with provenance and supersession.

Implication for Workspine:

- Store decisions, questions, evidence, dogfood findings, and session summaries as typed graph nodes.
- Do not ingest raw transcripts by default.
- Every memory entry needs source, time, privacy, and supersession semantics.

### 8. Runtime safety belongs at the tool/action boundary

Agent-Fence, AgentWard, and AgentTrust shift agent safety away from prompt-only safety and toward lifecycle security, trust boundaries, action interception, and trace-auditable breaks. MCP tool annotations also cannot be blindly trusted unless the server itself is trusted.

Implication for Workspine:

- Human gates must be tied to action risk and reversibility.
- `gsdd next` should identify when the next step would cross a privileged boundary.
- Publication/export checks should fail closed for local-only graph or evidence.
- Future browser or MCP provider work must treat localhost/control-plane trust as a security boundary.

### 9. Observability is not optional

OpenTelemetry GenAI conventions, LangSmith traces, Inspect evaluations, and OpenAI trace/eval guidance all point to the same requirement: long-term improvement needs observable runs, not summaries alone.

Implication for Workspine:

- `.work/graph/events.jsonl` should be trace-like enough to reconstruct decisions.
- `gsdd next` outputs should include confidence, reason, inputs considered, and skipped inputs.
- Verification and audit should cite the graph/evidence events they used.

### 10. Simplicity should be defended deliberately

Anthropic's guidance warns against complex frameworks when simpler composable patterns suffice. This supports the current Workspine direction: JSONL event log first, derived index second, no database or hosted memory until the file model is insufficient.

Implication for Workspine:

- Keep v1 file-based.
- Avoid SQLite, vector DBs, MCP memory servers, and hosted memory in the first milestone.
- Build testable seams so the storage backend can evolve later.

## Concrete Changes This Research Implies

Add or preserve these milestone constraints:

- `gsdd next` v1 is read-only routing plus optional local state validation, not an executor.
- `.work/graph/events.jsonl` is append-only and source-of-truth.
- `.work/graph/index.json` is rebuildable.
- Questions are durable interrupts.
- Review/audit and repair/fix-gaps are separate states.
- Evals include fixture states for every `gsdd next` output state.
- Dogfood findings are human feedback inputs, not random notes.
- Raw transcripts remain opt-in and local-only.
- Human gates are driven by stakes, reversibility, privacy, and authority boundaries.
- Every next-action packet should be machine-readable and human-readable.

## Prompt Delta For Future Agents

Add this to kickoff prompts:

```text
Harness-engineering requirements:
- Treat Workspine as an agent harness, not just a CLI.
- The harness contract includes instructions, tools, routing, state, graph memory, validation, evidence, evals, repair loops, human gates, and dogfood feedback.
- Design `gsdd next` so every continuation is replayable from durable state, not chat memory.
- Human gates must behave like durable interrupts: persist the question, pause, and resume from the answer.
- Separate review from repair: review emits structured findings; repair consumes them.
- Treat verify/audit/dogfood runs as trace/eval material for improving the harness.
- Long-horizon consistency requires state transitions, completion signals, traceability, stop conditions, and evidence-backed closure.
- Do not add complex infrastructure until the file-backed graph proves insufficient.
```
