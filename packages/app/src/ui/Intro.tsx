import { useState } from "react";

import { CHARACTERS, saveProfile, type Profile } from "../lib/profile";

/**
 * The intro page: name yourself, pick a villager. Characters are cosmetic —
 * flavor for the table, not roles. The wolf is dealt by the GM, in secret,
 * and could be wearing any of these faces.
 */
export function Intro({ onDone }: { onDone: (p: Profile) => void }) {
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);

  const ready = name.trim().length > 0 && characterId !== null;

  return (
    <div>
      <div className="panel">
        <p>
          One of the villagers named Gerald has been eaten. The village needs to know who you
          are — or at least, who you claim to be.
        </p>
        <div className="row">
          <label className="dim">your name</label>
          <input
            type="text"
            maxLength={24}
            placeholder="what do they call you?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <h2>Pick your villager</h2>
      <p className="dim">
        Flavor only — the wolf is dealt in secret and could be wearing any of these faces.
      </p>
      <div className="characters">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={`character ${characterId === c.id ? "selected" : ""}`}
            onClick={() => setCharacterId(c.id)}
          >
            <span className="emoji">{c.emoji}</span>
            <span>{c.title}</span>
            <span className="dim blurb">{c.blurb}</span>
          </button>
        ))}
      </div>

      <div className="row">
        <button
          className="primary"
          disabled={!ready}
          onClick={() => {
            const p = { name: name.trim(), characterId: characterId! };
            saveProfile(p);
            onDone(p);
          }}
        >
          {ready ? `Enter the village as ${name.trim()}` : "Name yourself and pick a villager"}
        </button>
      </div>
    </div>
  );
}
