import { useEffect, useRef, useState } from "react";

import { CHARACTERS, saveProfile, type Profile } from "../lib/profile";
import { CharEmoji } from "./CharIcon";
import { fetchPublicView, loadGameId } from "../lib/player";
import { GeraldStory } from "./Story";

/**
 * The intro: first the story of Gerald (page 1), then name + villager
 * (page 2). Characters are cosmetic — flavor for the table, not roles. The
 * werebear is dealt in secret and could be wearing any of these faces.
 */
export function Intro({
  onDone,
  address,
}: {
  onDone: (p: Profile) => void;
  /** The connected wallet, when there is one — so your own seat isn't
      mistaken for someone else's claim. */
  address?: string;
}) {
  const [page, setPage] = useState<"story" | "identity">("story");
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [seated, setSeated] = useState<{ name: string; character?: string | null } | null>(null);

  // One face per game: grey out characters claimed by OTHER players. Your own
  // seat stays open — locking it left returning players with nothing to pick
  // and a dead button.
  useEffect(() => {
    fetchPublicView(loadGameId())
      .then((v) => {
        const mine = address ? v.players.find((p) => p.address === address) : undefined;
        setTaken(
          new Set(
            v.players
              .filter((p) => p.address !== address)
              .map((p) => p.character)
              .filter((c): c is string => !!c),
          ),
        );
        setSeated(mine ? { name: mine.name, character: mine.character } : null);
        // Already seated in this game? Offer that identity back, pre-filled.
        if (mine) {
          setName((n) => n || mine.name);
          setCharacterId((c) => c ?? mine.character ?? null);
        }
      })
      .catch(() => setTaken(new Set())); // no game yet — all faces free
  }, [page, address]);

  const nameRef = useRef<HTMLInputElement>(null);
  const named = name.trim().length > 0;
  const ready = named && characterId !== null;
  // A picked face with no name used to dead-end here: the name field is above
  // eight big portraits, so it scrolls out of sight and the button gave no
  // clue which half was missing. Now it says so, and takes you there.
  const needsName = !named && characterId !== null;
  const cta = ready
    ? `Enter the village as ${name.trim()}`
    : needsName
      ? "Type your name to continue"
      : characterId === null && named
        ? "Pick a villager"
        : "Name yourself and pick a villager";

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
      <div className="row">
        <button className="back" onClick={() => setPage("story")}>
          ← Back to the story
        </button>
      </div>

      <div className="panel">
        <p>
          The village needs to know who you are — or at least, who you claim to be.
        </p>
        <div className="row">
          <label className="dim">your name</label>
          <input
            ref={nameRef}
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
        Whether you are a werebear or a villager will be determined after every character has
        been chosen.
      </p>
      {seated && (
        <p className="dim">
          You already hold a seat in this game as <b>{seated.name}</b> — that face is still
          yours, and it's selected below.
        </p>
      )}
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
          disabled={!ready && !needsName}
          onClick={() => {
            if (needsName) {
              nameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              nameRef.current?.focus();
              return;
            }
            const p = { name: name.trim(), characterId: characterId! };
            saveProfile(p);
            onDone(p);
          }}
        >
          {cta}
        </button>
        {needsName && (
          <span className="dim">
            {CHARACTERS.find((c) => c.id === characterId)?.title} is yours — the village just
            needs a name for you.
          </span>
        )}
      </div>
    </div>
  );
}
