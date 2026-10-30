// Neural Core leaderboard display. The server pushes a fresh board after
// every finished shift; this page only animates from the old board to the new.
(() => {
  "use strict";

  const rowsEl = document.getElementById("rows");
  const emptyEl = document.getElementById("empty");
  const totalEl = document.getElementById("total");
  const dot = document.getElementById("dot");
  const linkText = document.getElementById("linkText");
  const banner = document.getElementById("banner");

  const nodes = new Map(); // runId → <li>
  const fmt = (n) => Math.round(n).toLocaleString("en-IN");
  let bannerTimer = 0;
  let latestTimer = 0;

  function countUp(el, to, ms = 1200) {
    const from = Number(el.dataset.value || 0);
    el.dataset.value = String(to);
    if (from === to) {
      el.textContent = fmt(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function makeRow(r) {
    const li = document.createElement("li");
    li.className = "row";
    li.innerHTML =
      '<span class="rank num"></span>' +
      '<span class="who"><span class="name"></span><span class="title"></span></span>' +
      '<span class="focus num"></span><span class="mult num"></span><span class="score num"></span>';
    li.querySelector(".name").textContent = r.name;
    return li;
  }

  function fill(li, r) {
    li.querySelector(".rank").textContent = String(r.rank).padStart(2, "0");
    li.querySelector(".name").textContent = r.name;
    li.querySelector(".title").textContent = r.title;
    li.querySelector(".focus").textContent = Math.round(r.avgFocus) + "%";
    li.querySelector(".mult").textContent = "×" + r.maxMult;
    countUp(li.querySelector(".score"), r.score);
    if (r.rank <= 3) li.dataset.podium = String(r.rank);
    else delete li.dataset.podium;
  }

  function render(board) {
    // FLIP: remember where every row was, rebuild, then slide rows from there.
    const before = new Map();
    for (const [id, li] of nodes) before.set(id, li.getBoundingClientRect().top);

    const keep = new Set(board.rows.map((r) => r.runId));
    for (const [id, li] of nodes) {
      if (keep.has(id)) continue;
      nodes.delete(id);
      li.style.top = li.offsetTop + "px";
      li.classList.add("leave");
      setTimeout(() => li.remove(), 520);
    }

    board.rows.forEach((r) => {
      let li = nodes.get(r.runId);
      const fresh = !li;
      if (fresh) {
        li = makeRow(r);
        nodes.set(r.runId, li);
      }
      fill(li, r);
      rowsEl.appendChild(li); // moves existing nodes into the new order
      li.classList.toggle("enter", fresh && before.size > 0);
    });

    for (const [id, li] of nodes) {
      const was = before.get(id);
      if (was === undefined) continue;
      const dy = was - li.getBoundingClientRect().top;
      if (!dy) continue;
      li.style.transition = "none";
      li.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          li.style.transition = "transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1)";
          li.style.transform = "";
        });
      });
    }

    emptyEl.hidden = board.rows.length > 0;
    countUp(totalEl, board.totalRanked, 900);
    if (board.latest) announce(board.latest, board.totalRanked);
  }

  function announce(latest, total) {
    clearTimeout(latestTimer);
    for (const li of nodes.values()) li.classList.remove("latest");
    const li = nodes.get(latest.runId);
    if (li) li.classList.add("latest");
    latestTimer = setTimeout(() => li && li.classList.remove("latest"), 12000);

    document.getElementById("bName").textContent = latest.name;
    document.getElementById("bScore").textContent = fmt(latest.score) + " pts";
    document.getElementById("bRank").textContent = latest.rank ? `#${latest.rank} of ${total}` : "";
    clearTimeout(bannerTimer);
    banner.hidden = false;
    requestAnimationFrame(() => banner.classList.add("show"));
    bannerTimer = setTimeout(() => {
      banner.classList.remove("show");
      bannerTimer = setTimeout(() => (banner.hidden = true), 700);
    }, 9000);
  }

  // One socket, kept open. It reconnects if the game server restarts; it never polls.
  let backoff = 1000;
  function connect() {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/feed`);
    ws.onopen = () => {
      backoff = 1000;
      dot.dataset.on = "true";
      linkText.textContent = "Live · updates after every shift";
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "board") render(msg);
      } catch {
        // Ignore anything that is not a board.
      }
    };
    ws.onclose = () => {
      dot.dataset.on = "false";
      linkText.textContent = "Reconnecting to the game server";
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };
  }
  connect();
})();
