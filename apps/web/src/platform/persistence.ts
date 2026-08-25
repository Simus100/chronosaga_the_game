import { invoke } from "@tauri-apps/api/core";

/**
 * The systemic save boundary, as the interface sees it.
 *
 * Rust stores and returns bytes; it never parses a world. Everything here is
 * transport, and the only judgement made is which of the storage-level
 * situations occurred — not whether the payload is a usable world, which
 * `loadSystemicWorldState` decides.
 *
 * Declared as an interface so the gameplay controller can be tested against a
 * fake store. The simulation is never mocked; this is.
 */
export interface SystemicSaveReceipt {
  campaignId: string;
  envelopeVersion: number;
  payloadBytes: number;
}

export type SystemicStored =
  | { status: "notFound" }
  | { status: "found"; save: { campaignId: string; envelopeVersion: number; payload: string } }
  | { status: "incompatibleEnvelope"; storedVersion: number; supportedVersion: number };

export interface SystemicPersistence {
  save(campaignId: string, payload: string): Promise<SystemicSaveReceipt>;
  load(campaignId: string): Promise<SystemicStored>;
}

/** The real store: SQLite, through Tauri. */
export const tauriPersistence: SystemicPersistence = {
  save(campaignId, payload) {
    return invoke<SystemicSaveReceipt>("save_systemic_campaign", { campaignId, payload });
  },
  load(campaignId) {
    return invoke<SystemicStored>("load_systemic_campaign", { campaignId });
  }
};
