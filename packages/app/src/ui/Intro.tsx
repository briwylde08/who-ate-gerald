import { useState } from "react";

import { CHARACTERS, saveProfile, type Profile } from "../lib/profile";

/**
 * The intro: first the story of Gerald (page 1), then name + villager
 * (page 2). Characters are cosmetic — flavor for the table, not roles. The
 * werebear is dealt in secret and could be wearing any of these faces.
 */
export function Intro({ onDone }: { onDone: (p: Profile) => void }) {
  const [page, setPage] = useState<"story" | "identity">("story");
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);

  const ready = name.trim().length > 0 && characterId !== null;

  if (page === "story") {
    return (
      <div className="panel story">
        <p>One of the villagers named Gerald has been eaten.</p>
        <p>
          Eaten by a <b>werewolf</b> — we know because of the telltale signs of a{" "}
          <b>werebear</b> attack. Someone found his mangled remains at the treeline this
          morning: a still-lit lantern strapped to his arm, one croc, and nothing else. Bear
          tracks everywhere.
        </p>
        <p>
          There have been whispers of a werebear round these parts for years. And this is a
          remote town — nobody arrives, nobody leaves. Which means the werebear is{" "}
          <i>someone in town</i>. Someone you know. Someone who shops at the same five stores
          you do.
        </p>
        <p>
          It's your job to help your neighbors find the werebear.{" "}
          <b>Unless the werebear is you.</b>
        </p>
        <div className="row">
          <button className="primary" onClick={() => setPage("identity")} autoFocus>
            Find who ate Gerald
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <p>
          The village needs to know who you are — or at least, who you claim to be.
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
        Flavor only — the werebear is dealt in secret and could be wearing any of these faces.
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
