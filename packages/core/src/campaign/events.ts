import type { CampaignState } from './campaign.js';

export type CampaignEventKind = 'briefing' | 'warning' | 'reward' | 'loss';

export interface CampaignEvent {
  id: string;
  kind: CampaignEventKind;
  turn: number;
  title: string;
  body: string;
}

export function pushEvent(state: CampaignState, event: CampaignEvent) {
  if (!state.events) state.events = [];
  state.events.push(event);
  state.log.push(`${event.kind.toUpperCase()}: ${event.title}`);
}

export function consumeEvents(state: CampaignState): CampaignEvent[] {
  const evts = state.events ?? [];
  state.events = [];
  return evts;
}
