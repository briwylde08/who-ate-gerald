import { useEffect, useState } from "react";

import { CHARACTERS, saveProfile, type Profile } from "../lib/profile";
import { CharEmoji } from "./CharIcon";
import { fetchPublicView, loadGameId } from "../lib/player";
import { GeraldStory } from "./Story";

/**
 * The intro: first the story of Gerald (page 1), then name + villager
 * (page 2). Characters are cosmetic — flavor for the table, not roles. The
 * werebear is dealt in secret and could be wearing any of these faces.
 */
export function Intro({ onDone }: { onDone: (p: Profile) => void }) {
  const [page, setPage] = useState<"story" | "identity">("story");
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());

  // One face per game: grey out characters already claimed in this game.
  useEffect(() => {
    fetchPublicView(loadGameId())
      .then((v) =>
        setTaken(new Set(v.players.map((p) => p.character).filter((c): c is string => !!c))),
      )
      .catch(() => setTaken(new Set())); // no game yet — all faces free
  }, [page]);

  const ready = name.trim().length > 0 && characterId !== null;

  if (page === "story") {
    return (
      <div className="panel story">
        <GeraldStory />
        <div className="row">
          <button className="primary" onClick={() => setPage("identity")} autoFocus>
            Play Who Ate Gerald?
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
      <div className="characters picker">
        {CHARACTERS.map((c) => {
          const isTaken = taken.has(c.id);
          return (
            <button
              key={c.id}
              className={`character ${characterId === c.id ? "selected" : ""}`}
              disabled={isTaken}
              onClick={() => setCharacterId(c.id)}
            >
              <img className="portrait" src={c.image} alt={c.title} loading="lazy" />
              <span>
                <CharEmoji c={c} /> {c.title}
                {isTaken ? " — claimed" : ""}
              </span>
              <span className="dim blurb">{isTaken ? "Somebody already wears this face." : c.blurb}</span>
            </button>
          );
        })}
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
