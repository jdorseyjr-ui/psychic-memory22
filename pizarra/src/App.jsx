import React, { useState, useEffect, useMemo } from "react";
import { BookOpen, GraduationCap, Check, X, Plus, ClipboardList, TrendingUp, Volume2, Pencil, Trash2, Search, Repeat, Type } from "lucide-react";
import { getAll, saveVocab, saveGrammarScores } from "./storage/index.js";
import { ensureSchedule, reviewWord, sortForStudy, dueCount, isMastered, isLearning, isDue, qualityFor, meanMaturity } from "./lib/sm2.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const LEVEL_COLOR = {
  A1: "#F2C14E",
  A2: "#F0A857",
  B1: "#E8735C",
  B2: "#7EC8E3",
  C1: "#B9A6E0",
  C2: "#8FCB9B",
};

const LEVEL_BLURB = {
  A1: "Can understand and use very basic phrases, introduce yourself, and ask simple questions.",
  A2: "Can handle short, routine exchanges about familiar topics — shopping, family, local area.",
  B1: "Can manage most travel situations and give simple opinions or reasons for plans.",
  B2: "Can discuss abstract topics, follow the main ideas of complex text, and argue a viewpoint.",
  C1: "Can use language flexibly for social, academic, and professional purposes with few gaps.",
  C2: "Can understand virtually everything and express nuance, tone, and implication with ease.",
};

const SEED_VOCAB = [
  { id: "v1", es: "el horario", en: "the schedule", level: "A1", tag: "clase", mastered: false, reviews: 0 },
  { id: "v2", es: "ahora mismo", en: "right now", level: "A1", tag: "tiempo", mastered: false, reviews: 0 },
  { id: "v3", es: "sin embargo", en: "however", level: "A2", tag: "conector", mastered: false, reviews: 0 },
  { id: "v4", es: "darse cuenta", en: "to realize", level: "A2", tag: "verbo", mastered: false, reviews: 0 },
  { id: "v5", es: "a pesar de", en: "despite", level: "B1", tag: "conector", mastered: false, reviews: 0 },
  { id: "v6", es: "el desempeño", en: "the performance", level: "B1", tag: "trabajo", mastered: false, reviews: 0 },
  { id: "v7", es: "conllevar", en: "to entail", level: "B2", tag: "verbo", mastered: false, reviews: 0 },
  { id: "v8", es: "el matiz", en: "the nuance", level: "B2", tag: "abstracto", mastered: false, reviews: 0 },
  { id: "v9", es: "la índole", en: "the nature / kind", level: "C1", tag: "abstracto", mastered: false, reviews: 0 },
  { id: "v10", es: "recalcar", en: "to emphasize", level: "C1", tag: "verbo", mastered: false, reviews: 0 },
  { id: "v11", es: "la contienda", en: "the dispute / contest", level: "C2", tag: "abstracto", mastered: false, reviews: 0 },
  { id: "v12", es: "avezado", en: "seasoned / experienced", level: "C2", tag: "adjetivo", mastered: false, reviews: 0 },
];

const SEED_GRAMMAR = [
  {
    id: "g1",
    level: "A1",
    title: "Ser vs. Estar",
    rule: "Ser is for identity, origin, and traits that define something. Estar is for location, condition, and states that can change.",
    example: "Ella es doctora, pero hoy está cansada.",
    quiz: { q: "Yo ___ estudiante y ahora ___ en la biblioteca.", options: ["soy / estoy", "estoy / soy", "soy / soy"], answer: 0 },
  },
  {
    id: "g2",
    level: "A2",
    title: "Preterite vs. Imperfect",
    rule: "Preterite marks a completed action; imperfect describes background, habits, or ongoing states in the past.",
    example: "Cuando era niño, jugaba en el parque todos los días.",
    quiz: { q: "Ayer, mientras yo ___ la cena, mi hermano ___.", options: ["cocinaba / llegó", "cociné / llegaba", "cocinaba / llegaba"], answer: 0 },
  },
  {
    id: "g3",
    level: "B1",
    title: "Present Subjunctive after Wishes",
    rule: "Verbs of hope, wish, or request trigger the subjunctive in the following clause when there's a change of subject.",
    example: "Espero que tengas un buen viaje.",
    quiz: { q: "Quiero que tú ___ conmigo.", options: ["vienes", "vengas", "vinieras"], answer: 1 },
  },
  {
    id: "g4",
    level: "B2",
    title: "Subjunctive with Doubt & Denial",
    rule: "Expressions of doubt, denial, or uncertainty (no creo que, dudo que) call for the subjunctive.",
    example: "No creo que él tenga razón.",
    quiz: { q: "Dudo que ella ___ la verdad.", options: ["dice", "diga", "dirá"], answer: 1 },
  },
  {
    id: "g5",
    level: "C1",
    title: "Conditional Perfect + Pluperfect Subjunctive",
    rule: "Used for hypothetical past situations: what would have happened if something else had happened.",
    example: "Si hubiera estudiado más, habría aprobado el examen.",
    quiz: { q: "Si lo ___ sabido, te lo ___ dicho.", options: ["había / habría", "hubiera / habría", "hubiera / había"], answer: 1 },
  },
  {
    id: "g6",
    level: "C2",
    title: "Nuance: Pero vs. Sino vs. Sino que",
    rule: "Sino (que) corrects a preceding negative — 'not X but rather Y.' Pero simply adds a contrast.",
    example: "No es perezoso, sino muy ocupado.",
    quiz: { q: "No vino a la fiesta, ___ se quedó trabajando.", options: ["pero", "sino", "sino que"], answer: 2 },
  },
];

// The quiz view wants a { grammarId: true } map; storage wants records that
// can carry a userId. These two keep the translation in one place.
function scoresToMap(records) {
  const map = {};
  for (const r of records || []) if (r.correct) map[r.grammarId] = true;
  return map;
}

function mapToScores(map) {
  return Object.keys(map)
    .filter((k) => map[k])
    .map((grammarId) => ({ id: "gs-" + grammarId, grammarId, correct: true }));
}

function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function normalize(str) {
  return str.trim().toLowerCase().replace(/^(el|la|los|las)\s+/, "");
}

const audioSupported = typeof window !== "undefined" && "speechSynthesis" in window;

function speak(text) {
  if (!audioSupported) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "es-ES";
  window.speechSynthesis.speak(utter);
}

export default function App() {
  const [level, setLevel] = useState("A1");
  const [tab, setTab] = useState("vocab");
  const [vocab, setVocab] = useState([]);
  const [grammar] = useState(SEED_GRAMMAR);
  const [gramScore, setGramScore] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(null);

  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [practiceMode, setPracticeMode] = useState("recognize"); // 'recognize' | 'recall'
  const [recallInput, setRecallInput] = useState("");
  const [recallResult, setRecallResult] = useState(null); // null | 'correct' | 'wrong'

  const [showAdd, setShowAdd] = useState(false);
  const [newEs, setNewEs] = useState("");
  const [newEn, setNewEn] = useState("");
  const [newTag, setNewTag] = useState("");

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editEs, setEditEs] = useState("");
  const [editEn, setEditEn] = useState("");
  const [editTag, setEditTag] = useState("");

  const [activeGrammar, setActiveGrammar] = useState(null);
  const [quizChoice, setQuizChoice] = useState(null);

  // Load from disk once. An empty store means first run, so the seed list is
  // written out and becomes editable like anything else.
  useEffect(() => {
    let cancelled = false;
    getAll()
      .then(({ vocab: storedVocab, grammarScores }) => {
        if (cancelled) return;
        const source = storedVocab.length ? storedVocab : SEED_VOCAB;
        setVocab(source.map((v) => ensureSchedule(v)));
        setGramScore(scoresToMap(grammarScores));
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // Fall back to the seed list so the app still works read-only.
        setVocab(SEED_VOCAB.map((v) => ensureSchedule(v)));
        setStorageError("No se pudo leer el archivo de datos: " + err.message);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveVocab(vocab).catch((err) => setStorageError("No se pudo guardar: " + err.message));
  }, [vocab, loaded]);

  useEffect(() => {
    if (!loaded) return;
    saveGrammarScores(mapToScores(gramScore)).catch((err) =>
      setStorageError("No se pudo guardar: " + err.message));
  }, [gramScore, loaded]);

  const levelVocab = useMemo(() => vocab.filter((v) => v.level === level), [vocab, level]);
  const filteredVocab = levelVocab.filter((v) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return v.es.toLowerCase().includes(q) || v.en.toLowerCase().includes(q) || v.tag.toLowerCase().includes(q);
  });
  const levelGrammar = grammar.filter((g) => g.level === level);

  // The queue is ordered due-first and then held steady for the session:
  // grading a card pushes its next review out, and re-sorting on every answer
  // would shuffle the deck under the reader and skip cards.
  const levelIds = levelVocab.map((v) => v.id).join(",");
  const [queueIds, setQueueIds] = useState([]);
  useEffect(() => {
    setQueueIds(sortForStudy(levelVocab).map((v) => v.id));
    setCardIdx(0);
    setFlipped(false);
    setRecallInput("");
    setRecallResult(null);
  // levelIds tracks which words are in play; re-sorting on schedule changes
  // alone is what we are deliberately avoiding here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelIds]);

  const queue = queueIds.map((id) => vocab.find((v) => v.id === id)).filter(Boolean);
  const card = queue.length ? queue[cardIdx % queue.length] : undefined;
  const dueToday = dueCount(levelVocab);

  function resetCardState() {
    setFlipped(false);
    setRecallInput("");
    setRecallResult(null);
  }

  function addWord(e) {
    e.preventDefault();
    if (!newEs.trim() || !newEn.trim()) return;
    setVocab((v) => [...v, ensureSchedule({ id: uid("v"), es: newEs.trim(), en: newEn.trim(), level, tag: newTag.trim() || "general" })]);
    setNewEs(""); setNewEn(""); setNewTag("");
    setShowAdd(false);
  }

  function runImport() {
    const lines = importText.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((line) => {
      const parts = line.split(";").map((p) => p.trim());
      return ensureSchedule({ id: uid("v"), es: parts[0] || "?", en: parts[1] || "?", level, tag: parts[2] || "importado" });
    });
    setVocab((v) => [...v, ...parsed]);
    setImportText("");
    setShowImport(false);
  }

  // Recognize ("lo sé" / "aún aprendiendo") and recall (typed answer right or
  // wrong) both arrive here, so a word keeps one schedule however it was drilled.
  function markCard(known) {
    const id = card.id;
    setVocab((prev) => prev.map((v) => (v.id === id ? reviewWord(v, qualityFor(known)) : v)));
    resetCardState();
    setCardIdx((i) => i + 1);
  }

  function checkRecall() {
    const correct = normalize(recallInput) === normalize(card.es);
    setRecallResult(correct ? "correct" : "wrong");
  }

  function startEdit(v) {
    setEditingId(v.id);
    setEditEs(v.es);
    setEditEn(v.en);
    setEditTag(v.tag);
  }

  function saveEdit(id) {
    setVocab((prev) => prev.map((v) => (v.id === id ? { ...v, es: editEs.trim() || v.es, en: editEn.trim() || v.en, tag: editTag.trim() || v.tag } : v)));
    setEditingId(null);
  }

  function deleteWord(id) {
    setVocab((prev) => prev.filter((v) => v.id !== id));
  }

  function answerQuiz(gId, choiceIdx) {
    setQuizChoice(choiceIdx);
    const g = grammar.find((x) => x.id === gId);
    if (choiceIdx === g.quiz.answer) {
      setGramScore((s) => ({ ...s, [gId]: true }));
    }
  }

  const atLevel = (lv) => vocab.filter((v) => v.level === lv);
  const totalByLevel = (lv) => atLevel(lv).length;
  const masteredByLevel = (lv) => atLevel(lv).filter(isMastered).length;
  const learningByLevel = (lv) => atLevel(lv).filter(isLearning).length;
  const grammarTotalByLevel = (lv) => grammar.filter((g) => g.level === lv).length;
  const grammarDoneByLevel = (lv) => grammar.filter((g) => g.level === lv && gramScore[g.id]).length;

  const lc = LEVEL_COLOR[level];

  return (
    <div style={styles.root}>
      <style>{CSS}</style>

      <header style={styles.header}>
        <div style={styles.headerTop}>
          <GraduationCap size={26} color="#F4F1E8" strokeWidth={1.8} />
          <div>
            <h1 style={styles.title}>La Pizarra</h1>
            <p style={styles.subtitle}>vocabulario y gramática, nivel por nivel</p>
          </div>
        </div>

        <div className="ladder">
          {LEVELS.map((lv, i) => (
            <React.Fragment key={lv}>
              <button
                onClick={() => { setLevel(lv); setCardIdx(0); resetCardState(); }}
                className={"rung" + (lv === level ? " rung-active" : "")}
                style={{ "--rung-color": LEVEL_COLOR[lv] }}
              >
                {lv}
              </button>
              {i < LEVELS.length - 1 && <span className="rung-link" />}
            </React.Fragment>
          ))}
        </div>
        <p className="blurb" style={{ borderColor: lc }}>{LEVEL_BLURB[level]}</p>
      </header>

      {storageError && <p className="storage-error">{storageError}</p>}

      <nav className="tabs">
        <button className={"tab" + (tab === "vocab" ? " tab-active" : "")} onClick={() => setTab("vocab")}>
          <BookOpen size={16} /> Vocabulario
        </button>
        <button className={"tab" + (tab === "grammar" ? " tab-active" : "")} onClick={() => setTab("grammar")}>
          <ClipboardList size={16} /> Gramática
        </button>
        <button className={"tab" + (tab === "progress" ? " tab-active" : "")} onClick={() => setTab("progress")}>
          <TrendingUp size={16} /> Progreso
        </button>
      </nav>

      <main className="panel">
        {tab === "vocab" && (
          <div>
            <div className="flash-wrap">
              {!loaded ? (
                <p className="empty">cargando…</p>
              ) : levelVocab.length === 0 || !card ? (
                <p className="empty">No hay palabras en {level} todavía. Añade una abajo.</p>
              ) : (
                <div className="card-stage">
                  <div className="mode-toggle">
                    <button
                      className={"mode-btn" + (practiceMode === "recognize" ? " mode-active" : "")}
                      onClick={() => { setPracticeMode("recognize"); resetCardState(); }}
                    >
                      <Repeat size={13} /> reconocer
                    </button>
                    <button
                      className={"mode-btn" + (practiceMode === "recall" ? " mode-active" : "")}
                      onClick={() => { setPracticeMode("recall"); resetCardState(); }}
                    >
                      <Type size={13} /> recordar
                    </button>
                  </div>

                  <p className="due-line">
                    {dueToday > 0
                      ? dueToday + (dueToday === 1 ? " tarjeta para repasar hoy" : " tarjetas para repasar hoy")
                      : "nada pendiente hoy — repaso libre"}
                  </p>

                  {practiceMode === "recognize" ? (
                    <>
                      <div className={"index-card" + (flipped ? " flipped" : "")} onClick={() => setFlipped((f) => !f)} style={{ borderTopColor: lc }}>
                        <span className="card-tag">{card.tag}</span>
                        <p className="card-word">{flipped ? card.en : card.es}</p>
                        {audioSupported && !flipped && (
                          <button className="icon-btn card-audio" onClick={(e) => { e.stopPropagation(); speak(card.es); }} aria-label="escuchar">
                            <Volume2 size={16} />
                          </button>
                        )}
                        <span className="card-hint">{flipped ? "toca para ver el español" : "toca para revelar"}</span>
                      </div>
                      <div className="card-actions">
                        <button className="btn btn-no" onClick={() => markCard(false)}><X size={16} /> aún aprendiendo</button>
                        <button className="btn btn-yes" onClick={() => markCard(true)}><Check size={16} /> lo sé</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="index-card recall-card" style={{ borderTopColor: lc }}>
                        <span className="card-tag">{card.tag}</span>
                        <p className="card-word">{card.en}</p>
                        <input
                          className="recall-input"
                          placeholder="escribe la palabra en español"
                          value={recallInput}
                          onChange={(e) => setRecallInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && recallResult === null) checkRecall(); }}
                        />
                        {recallResult && (
                          <p className={"recall-feedback " + (recallResult === "correct" ? "feedback-correct" : "feedback-wrong")}>
                            {recallResult === "correct" ? "¡correcto!" : `la respuesta era: ${card.es}`}
                            {audioSupported && (
                              <button className="icon-btn" onClick={() => speak(card.es)} aria-label="escuchar">
                                <Volume2 size={14} />
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="card-actions">
                        {recallResult === null ? (
                          <button className="btn btn-primary-wide" onClick={checkRecall}>revisar</button>
                        ) : (
                          <button className="btn btn-primary-wide" onClick={() => markCard(recallResult === "correct")}>siguiente</button>
                        )}
                      </div>
                    </>
                  )}
                  <p className="card-progress">{cardIdx % queue.length + 1} / {queue.length} en {level}</p>
                </div>
              )}
            </div>

            <div className="list-head">
              <h3>Lista de {level}</h3>
              <div className="list-head-btns">
                <button className="btn-small" onClick={() => setShowImport((s) => !s)}>importar</button>
                <button className="btn-small btn-primary" onClick={() => setShowAdd((s) => !s)}><Plus size={14} /> añadir</button>
              </div>
            </div>

            {showAdd && (
              <form className="add-form" onSubmit={addWord}>
                <input placeholder="español" value={newEs} onChange={(e) => setNewEs(e.target.value)} />
                <input placeholder="inglés" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
                <input placeholder="etiqueta (opcional)" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
                <button type="submit" className="btn-small btn-primary">guardar</button>
              </form>
            )}

            {showImport && (
              <div className="add-form">
                <textarea
                  className="import-area"
                  placeholder={"pega tu lista, una por línea:\npalabra;traducción;etiqueta"}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <button className="btn-small btn-primary" onClick={runImport}>importar a {level}</button>
              </div>
            )}

            <div className="search-row">
              <Search size={14} className="search-icon" />
              <input
                className="search-input"
                placeholder={`buscar en ${level}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <ul className="vocab-list">
              {filteredVocab.length === 0 && <p className="empty small">sin resultados</p>}
              {filteredVocab.map((v) => (
                <li key={v.id} className="vocab-row">
                  {editingId === v.id ? (
                    <div className="edit-row">
                      <input value={editEs} onChange={(e) => setEditEs(e.target.value)} />
                      <input value={editEn} onChange={(e) => setEditEn(e.target.value)} />
                      <input value={editTag} onChange={(e) => setEditTag(e.target.value)} />
                      <button className="icon-btn" onClick={() => saveEdit(v.id)} aria-label="guardar"><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setEditingId(null)} aria-label="cancelar"><X size={15} /></button>
                    </div>
                  ) : (
                    <>
                      <span
                        className={"dot" + (isMastered(v) ? " dot-on" : "") + (isLearning(v) ? " dot-learning" : "") + (isDue(v) ? " dot-due" : "")}
                        style={{ "--dot-color": lc }}
                        title={isMastered(v) ? "dominada" : isLearning(v) ? "en curso" : isDue(v) ? "toca repasar" : "programada"}
                      />
                      <span className="vocab-es">{v.es}</span>
                      <span className="vocab-en">{v.en}</span>
                      <span className="vocab-tag">{v.tag}</span>
                      <span className="row-actions">
                        {audioSupported && (
                          <button className="icon-btn" onClick={() => speak(v.es)} aria-label="escuchar"><Volume2 size={14} /></button>
                        )}
                        <button className="icon-btn" onClick={() => startEdit(v)} aria-label="editar"><Pencil size={14} /></button>
                        <button className="icon-btn" onClick={() => deleteWord(v.id)} aria-label="eliminar"><Trash2 size={14} /></button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "grammar" && (
          <div>
            {levelGrammar.length === 0 && <p className="empty">Sin puntos de gramática para {level} todavía.</p>}
            {levelGrammar.map((g) => (
              <div key={g.id} className="grammar-card" style={{ borderLeftColor: lc }}>
                <h3>{g.title}</h3>
                <p className="rule">{g.rule}</p>
                <p className="example">
                  “{g.example}”
                  {audioSupported && (
                    <button className="icon-btn" onClick={() => speak(g.example)} aria-label="escuchar"><Volume2 size={14} /></button>
                  )}
                </p>

                <div className="quiz">
                  <p className="quiz-q">{g.quiz.q}</p>
                  <div className="quiz-options">
                    {g.quiz.options.map((opt, idx) => {
                      const isActive = activeGrammar === g.id && quizChoice === idx;
                      const isCorrect = idx === g.quiz.answer;
                      let cls = "quiz-option";
                      if (isActive && isCorrect) cls += " opt-correct";
                      else if (isActive && !isCorrect) cls += " opt-wrong";
                      return (
                        <button
                          key={idx}
                          className={cls}
                          onClick={() => { setActiveGrammar(g.id); answerQuiz(g.id, idx); }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {gramScore[g.id] && <p className="quiz-done">practicado ✓</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "progress" && (
          <div className="progress-view">
            {LEVELS.map((lv) => {
              const total = totalByLevel(lv);
              const mastered = masteredByLevel(lv);
              const learning = learningByLevel(lv);
              // Solid to what's mastered, translucent to how far the level has
              // come overall — so a correct answer today shows up today,
              // rather than three weeks from now when the interval crosses.
              const vPct = total ? Math.round((mastered / total) * 100) : 0;
              const mPct = Math.round(meanMaturity(atLevel(lv)) * 100);
              const gTotal = grammarTotalByLevel(lv);
              const gDone = grammarDoneByLevel(lv);
              const gPct = gTotal ? Math.round((gDone / gTotal) * 100) : 0;
              return (
                <div key={lv} className="progress-row">
                  <div className="progress-label">
                    <span className="progress-badge" style={{ background: LEVEL_COLOR[lv] }}>{lv}</span>
                    <span className="progress-nums">
                      vocab {mastered}/{total}
                      {learning > 0 && ` · ${learning} en curso`}
                      {" · "}gramática {gDone}/{gTotal}
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill bar-fill-soft" style={{ width: mPct + "%", background: LEVEL_COLOR[lv] }} />
                    <div className="bar-fill bar-fill-mastered" style={{ width: vPct + "%", background: LEVEL_COLOR[lv] }} />
                  </div>
                  <div className="bar-track bar-track-thin">
                    <div className="bar-fill" style={{ width: gPct + "%", background: LEVEL_COLOR[lv], opacity: 0.6 }} />
                  </div>
                </div>
              );
            })}
            <p className="progress-note">Barras ilustrativas — no son una certificación oficial de nivel, solo una forma de ver dónde enfocar tu práctica.</p>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  root: { minHeight: "100vh", background: "#1F3A34", color: "#F4F1E8", fontFamily: "'IBM Plex Sans', sans-serif", padding: "20px 16px 48px" },
  header: { maxWidth: 640, margin: "0 auto 8px" },
  headerTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 },
  title: { fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: 0.3 },
  subtitle: { margin: 0, fontSize: 12.5, opacity: 0.65, fontFamily: "'IBM Plex Mono', monospace" },
};

const CSS = `
.ladder { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0; max-width: 640px; margin: 0 auto 10px; }
.rung { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500; width: 40px; height: 40px; border-radius: 50%;
  border: 2px dashed rgba(244,241,232,0.35); background: transparent; color: #F4F1E8; cursor: pointer; transition: all .15s ease; }
.rung:hover { border-color: rgba(244,241,232,0.7); }
.rung-active { border-style: solid; border-color: var(--rung-color); color: #1F3A34; background: var(--rung-color); font-weight: 700;
  box-shadow: 0 0 0 3px rgba(244,241,232,0.15); }
.rung-link { width: 18px; height: 1px; background: repeating-linear-gradient(to right, rgba(244,241,232,0.4) 0 4px, transparent 4px 8px); }

.blurb { text-align: center; max-width: 480px; margin: 6px auto 0; font-size: 13px; opacity: 0.8; border-left: 3px solid; padding-left: 10px; text-align: left; }

.tabs { display: flex; justify-content: center; gap: 6px; max-width: 640px; margin: 18px auto 0; flex-wrap: wrap; }
.tab { display: flex; align-items: center; gap: 6px; background: rgba(244,241,232,0.06); border: 1px solid rgba(244,241,232,0.15);
  color: #F4F1E8; padding: 8px 14px; border-radius: 20px; font-size: 13px; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; }
.tab-active { background: #F4F1E8; color: #1F3A34; font-weight: 600; border-color: #F4F1E8; }

.panel { max-width: 640px; margin: 18px auto 0; }
.empty { text-align: center; opacity: 0.6; font-size: 14px; padding: 20px 0; }
.empty.small { padding: 10px 0; font-size: 12.5px; }

.card-stage { display: flex; flex-direction: column; align-items: center; }
.mode-toggle { display: flex; gap: 6px; margin-bottom: 12px; }
.mode-btn { display: flex; align-items: center; gap: 5px; background: rgba(244,241,232,0.06); border: 1px solid rgba(244,241,232,0.2);
  color: #F4F1E8; padding: 5px 12px; border-radius: 14px; font-size: 12px; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; opacity: 0.75; }
.mode-active { background: #F4F1E8; color: #1F3A34; font-weight: 600; opacity: 1; }

.index-card { width: 100%; max-width: 360px; min-height: 150px; background: #F4F1E8; color: #1F3A34; border-radius: 4px;
  border-top: 5px solid; box-shadow: 0 8px 18px rgba(0,0,0,0.25); padding: 20px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; cursor: pointer; transform: rotate(-0.6deg); transition: transform .15s; gap: 8px; position: relative; }
.index-card:hover { transform: rotate(0deg); }
.recall-card { cursor: default; }
.card-tag { font-family: 'IBM Plex Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; }
.card-word { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 600; margin: 4px 0; }
.card-hint { font-size: 11.5px; opacity: 0.5; font-family: 'IBM Plex Mono', monospace; }
.card-audio { position: absolute; top: 12px; right: 12px; color: #1F3A34; }
.card-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn { display: flex; align-items: center; gap: 6px; border-radius: 20px; padding: 9px 16px; font-size: 13px; cursor: pointer; border: 1px solid rgba(244,241,232,0.3); background: transparent; color: #F4F1E8; font-family: 'IBM Plex Sans', sans-serif; }
.btn-yes { background: #8FCB9B; color: #1F3A34; border-color: #8FCB9B; font-weight: 600; }
.btn-no { opacity: 0.85; }
.btn-primary-wide { background: #F4F1E8; color: #1F3A34; font-weight: 600; border-color: #F4F1E8; padding: 9px 28px; }
.due-line { font-size: 11.5px; opacity: 0.65; margin: 0 0 10px; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.02em; }
.dot-due { border-color: rgba(244,241,232,0.9); box-shadow: 0 0 0 2px rgba(244,241,232,0.18); }
.storage-error { max-width: 640px; margin: 12px auto 0; background: rgba(232,115,92,0.15); border: 1px solid #E8735C;
  border-radius: 6px; padding: 8px 12px; font-size: 12.5px; font-family: 'IBM Plex Mono', monospace; }
.card-progress { font-size: 11.5px; opacity: 0.55; margin-top: 10px; font-family: 'IBM Plex Mono', monospace; }

.recall-input { width: 100%; margin-top: 6px; background: rgba(31,58,52,0.06); border: 1px solid rgba(31,58,52,0.25); border-radius: 6px;
  padding: 8px 10px; font-size: 14px; color: #1F3A34; text-align: center; font-family: 'IBM Plex Sans', sans-serif; }
.recall-feedback { display: flex; align-items: center; gap: 6px; justify-content: center; font-size: 13px; font-weight: 600; margin-top: 4px; }
.feedback-correct { color: #2f6b3f; }
.feedback-wrong { color: #a8402d; }

.list-head { display: flex; justify-content: space-between; align-items: center; margin: 28px 0 10px; }
.list-head h3 { font-family: 'Fraunces', serif; font-weight: 600; margin: 0; font-size: 17px; }
.list-head-btns { display: flex; gap: 8px; }
.btn-small { font-size: 12px; padding: 6px 12px; border-radius: 16px; border: 1px solid rgba(244,241,232,0.3); background: transparent; color: #F4F1E8; cursor: pointer; display: flex; align-items: center; gap: 4px; font-family: 'IBM Plex Sans', sans-serif; }
.btn-primary { background: #F4F1E8; color: #1F3A34; font-weight: 600; border-color: #F4F1E8; }

.add-form { display: flex; flex-wrap: wrap; gap: 8px; background: rgba(244,241,232,0.06); padding: 12px; border-radius: 8px; margin-bottom: 12px; }
.add-form input { flex: 1 1 120px; background: rgba(244,241,232,0.1); border: 1px solid rgba(244,241,232,0.25); border-radius: 6px; padding: 8px 10px; color: #F4F1E8; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; }
.import-area { width: 100%; min-height: 90px; background: rgba(244,241,232,0.1); border: 1px solid rgba(244,241,232,0.25); border-radius: 6px; padding: 10px; color: #F4F1E8; font-size: 13px; font-family: 'IBM Plex Mono', monospace; resize: vertical; }

.search-row { display: flex; align-items: center; gap: 8px; background: rgba(244,241,232,0.06); border: 1px solid rgba(244,241,232,0.2); border-radius: 16px; padding: 6px 12px; margin-bottom: 10px; }
.search-icon { opacity: 0.5; flex-shrink: 0; }
.search-input { flex: 1; background: transparent; border: none; color: #F4F1E8; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; outline: none; }

.vocab-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.vocab-row { display: grid; grid-template-columns: 14px 1.1fr 1.1fr 0.7fr auto; align-items: center; gap: 8px; padding: 9px 6px; border-bottom: 1px solid rgba(244,241,232,0.08); font-size: 13.5px; }
.dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid rgba(244,241,232,0.4); }
.dot-on { background: var(--dot-color); border-color: var(--dot-color); }
.dot-learning { background: var(--dot-color); border-color: var(--dot-color); opacity: 0.45; }
.vocab-es { font-weight: 500; }
.vocab-en { opacity: 0.75; }
.vocab-tag { font-family: 'IBM Plex Mono', monospace; font-size: 11px; opacity: 0.5; text-align: right; }
.row-actions { display: flex; gap: 2px; justify-self: end; }
.icon-btn { background: transparent; border: none; color: #F4F1E8; opacity: 0.6; cursor: pointer; padding: 4px; display: flex; align-items: center; border-radius: 4px; }
.icon-btn:hover { opacity: 1; background: rgba(244,241,232,0.1); }

.edit-row { display: grid; grid-template-columns: 1fr 1fr 0.8fr auto auto; gap: 6px; align-items: center; }
.edit-row input { background: rgba(244,241,232,0.1); border: 1px solid rgba(244,241,232,0.3); border-radius: 4px; padding: 5px 8px; color: #F4F1E8; font-size: 12.5px; font-family: 'IBM Plex Sans', sans-serif; }

.grammar-card { background: rgba(244,241,232,0.06); border-left: 4px solid; border-radius: 6px; padding: 16px 18px; margin-bottom: 14px; }
.grammar-card h3 { font-family: 'Fraunces', serif; margin: 0 0 8px; font-size: 17px; }
.rule { font-size: 13.5px; opacity: 0.85; margin: 0 0 8px; line-height: 1.5; }
.example { font-family: 'Caveat', cursive; font-size: 19px; opacity: 0.9; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.quiz-q { font-size: 13.5px; margin: 0 0 8px; font-weight: 500; }
.quiz-options { display: flex; flex-wrap: wrap; gap: 8px; }
.quiz-option { background: rgba(244,241,232,0.08); border: 1px solid rgba(244,241,232,0.25); color: #F4F1E8; padding: 7px 12px; border-radius: 16px; font-size: 13px; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; }
.opt-correct { background: #8FCB9B; color: #1F3A34; border-color: #8FCB9B; font-weight: 600; }
.opt-wrong { background: #E8735C; color: #1F3A34; border-color: #E8735C; font-weight: 600; }
.quiz-done { font-size: 11.5px; opacity: 0.6; margin-top: 8px; font-family: 'IBM Plex Mono', monospace; }

.progress-view { display: flex; flex-direction: column; gap: 16px; }
.progress-row { display: flex; flex-direction: column; gap: 6px; }
.progress-label { display: flex; align-items: center; gap: 10px; }
.progress-badge { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 700; color: #1F3A34; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.progress-nums { font-size: 12.5px; opacity: 0.75; }
.bar-track { position: relative; width: 100%; height: 8px; background: rgba(244,241,232,0.1); border-radius: 4px; overflow: hidden; }
.bar-fill-soft { position: absolute; left: 0; top: 0; opacity: 0.4; }
.bar-fill-mastered { position: absolute; left: 0; top: 0; }
.bar-track-thin { height: 4px; }
.bar-fill { height: 100%; border-radius: 4px; transition: width .3s ease; }
.progress-note { font-size: 12px; opacity: 0.5; margin-top: 6px; }

@media (max-width: 420px) {
  .vocab-row { grid-template-columns: 10px 1fr 1fr auto; }
  .vocab-tag { display: none; }
  .edit-row { grid-template-columns: 1fr 1fr auto auto; }
}
`;
