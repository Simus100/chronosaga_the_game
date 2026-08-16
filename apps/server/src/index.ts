import Fastify from "fastify";
import cors from "@fastify/cors";
import { createCampaign, resolveChoice, selectEvent } from "@paa/game-core";
import { demoEvents } from "@paa/game-data";
import { ProceduralNarrator } from "@paa/procedural-narrator";
import { memoryStore } from "./services/memory-store";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const narrator = new ProceduralNarrator();

app.get("/api/v1/health", async () => ({
  ok: true,
  service: "parametric-ai-adventure-api",
  aiMode: process.env.AI_MODE ?? "procedural"
}));

app.post<{ Body: { seed?: number } }>("/api/v1/campaigns", async (request) => {
  const state = createCampaign(request.body?.seed ?? Date.now() % 1000000);
  memoryStore.set(state);
  return state;
});

app.get<{ Params: { id: string } }>("/api/v1/campaigns/:id/state", async (request, reply) => {
  const state = memoryStore.get(request.params.id);
  if (!state) return reply.code(404).send({ error: "campaign_not_found" });
  return state;
});

app.get<{ Params: { id: string } }>("/api/v1/campaigns/:id/event/current", async (request, reply) => {
  const state = memoryStore.get(request.params.id);
  if (!state) return reply.code(404).send({ error: "campaign_not_found" });
  return selectEvent(demoEvents, state);
});

app.post<{
  Params: { id: string; eventId: string };
  Body: { choiceId: string };
}>("/api/v1/campaigns/:id/event/:eventId/choice", async (request, reply) => {
  const state = memoryStore.get(request.params.id);
  if (!state) return reply.code(404).send({ error: "campaign_not_found" });

  const event = demoEvents.find(e => e.id === request.params.eventId);
  const choice = event?.choices.find(c => c.id === request.body.choiceId);
  if (!event || !choice) return reply.code(404).send({ error: "event_or_choice_not_found" });

  const result = resolveChoice(state, choice, `event:${event.id}:${choice.id}`);
  memoryStore.set(result.state);
  memoryStore.append(result.state.campaignId, result.delta);

  const narration = await narrator.generateNarration({
    turn: result.state.turn,
    relevantCharacters: result.state.party.map(c => ({
      id: c.id,
      name: c.name,
      role: c.role,
      stress: c.stress,
      traits: c.traits
    })),
    relevantMemory: Object.keys(result.state.flags).filter(k => Boolean(result.state.flags[k])).slice(0, 8),
    recentDelta: result.delta.changes,
    event: { id: event.id, title: event.title, body: event.body },
    playerAction: choice.label
  });

  return { ...result, narration };
});

const port = Number(process.env.API_PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
