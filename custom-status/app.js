const stateLabels = {
  normal: { text: "正常", className: "state-normal", overall: "OPERATIONAL" },
  degraded: { text: "降级", className: "state-degraded", overall: "DEGRADED" },
  down: { text: "异常", className: "state-down", overall: "DOWN" },
  unknown: { text: "未知", className: "state-unknown", overall: "UNKNOWN" },
  operational: { text: "正常", className: "state-normal", overall: "OPERATIONAL" },
};

const iconLabels = {
  openai: "◎",
  gemini: "✦",
  kiro: "K",
  grok: "G",
  pragma: "P",
  chat: "C",
  image: "I",
};

let activeRange = 7;
let pollSeconds = 60;
let nextRefreshAt = Date.now() + pollSeconds * 1000;
let countdownTimer = null;

const cardsEl = document.querySelector("#cards");
const template = document.querySelector("#card-template");
const refreshButton = document.querySelector("#refresh");
const updatedAt = document.querySelector("#updated-at");
const normalCount = document.querySelector("#normal-count");
const totalCount = document.querySelector("#total-count");
const overall = document.querySelector("#overall");
const notice = document.querySelector("#notice");
const pollLabel = document.querySelector("#poll-label");

function formatMs(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Math.round(Number(value))} ms`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatUpdatedAt(value) {
  if (!value) return "更新于 --";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新于 --";
  const text = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `更新于 ${text}`;
}

function setOverall(value) {
  const meta = stateLabels[value] || stateLabels.unknown;
  overall.classList.remove("degraded", "down", "unknown");
  if (value === "degraded") overall.classList.add("degraded");
  if (value === "down") overall.classList.add("down");
  if (value === "unknown") overall.classList.add("unknown");
  overall.querySelector("span:last-child").textContent = meta.overall;
}

function barClass(status) {
  if (status === 1) return "up";
  if (status === 2 || status === 3) return "warn";
  if (status === 0) return "down";
  return "unknown";
}

function renderNotice(cards) {
  const upstreamOfficials = cards.filter(
    (card) => card.official && ["OpenAI", "Gemini"].includes(card.official.provider),
  );
  const degradedOfficials = upstreamOfficials.filter(
    (card) => card.official.state === "degraded",
  );
  notice.classList.remove("hidden", "ok");
  if (!degradedOfficials.length) {
    notice.classList.add("ok");
    const statusText = upstreamOfficials
      .map((card) => `${card.official.provider} ${card.official.label}`)
      .join(" · ");
    notice.textContent = `官方降级：无 · ${statusText || "上游状态暂无数据"}`;
    return;
  }
  notice.textContent = degradedOfficials
    .map((card) => `${card.title} 官方降级：${card.official.detail || card.official.label}`)
    .join(" · ");
}

function proxyNodeClass(success) {
  if (success === true) return "proxy-node-ok";
  if (success === false) return "proxy-node-fail";
  return "proxy-node-unknown";
}

function renderProxyHealth(container, proxyHealth) {
  const block = container.querySelector(".proxy-health");
  const nodesEl = container.querySelector(".proxy-nodes");
  if (!block || !nodesEl) return;

  const proxies = proxyHealth && Array.isArray(proxyHealth.proxies) ? proxyHealth.proxies : [];
  if (!proxies.length) {
    block.classList.add("hidden");
    nodesEl.replaceChildren();
    return;
  }

  block.classList.remove("hidden");
  const boundProxy = proxyHealth.boundProxy ? String(proxyHealth.boundProxy) : "";
  const labelEl = block.querySelector(".proxy-health-label");
  if (labelEl) {
    labelEl.textContent = boundProxy ? `绑定出口 · ${boundProxy.replace(/^kookeey-/, "")}` : "绑定出口";
  }
  nodesEl.replaceChildren(
    ...proxies.map((proxy) => {
      const item = document.createElement("span");
      const shortName = String(proxy.name || "").replace(/^kookeey-/, "");
      const totalMs =
        proxy.totalMs === null || proxy.totalMs === undefined ? "--" : `${Math.round(proxy.totalMs)}ms`;
      item.className = `proxy-node ${proxyNodeClass(proxy.success)}`;
      item.textContent = `${shortName}: ${proxy.success ? "正常" : "异常"} (${totalMs})`;
      item.title = proxy.errorMessage || proxyHealth.detail || "";
      return item;
    }),
  );
}

function renderCard(card) {
  const node = template.content.firstElementChild.cloneNode(true);
  const stateMeta = stateLabels[card.status] || stateLabels.unknown;
  node.querySelector("h2").textContent = card.title;
  const statePill = node.querySelector(".state-pill");
  statePill.textContent = stateMeta.text;
  statePill.classList.add(stateMeta.className);
  node.querySelector(".provider-icon").textContent = iconLabels[card.icon] || "•";
  node.querySelector(".provider-pill").textContent = card.provider;
  node.querySelector(".model-name").textContent = card.model;
  node.querySelector(".latency").textContent = formatMs(card.latencyMs);
  node.querySelector(".ping").textContent = formatMs(card.pingMs);
  node.querySelector(".availability-label").textContent = `可用性（${activeRange} 天）`;
  node.querySelector(".availability-count").textContent =
    card.availability && card.availability.total
      ? `${card.availability.success}/${card.availability.total} 成功`
      : "暂无样本";
  node.querySelector(".availability-rate").textContent = formatPercent(
    card.availability ? card.availability.ratio : null,
  );
  const bars = node.querySelector(".bars");
  (card.history || []).slice(-60).forEach((status) => {
    const bar = document.createElement("span");
    bar.className = `bar ${barClass(status)}`;
    bars.appendChild(bar);
  });
  renderProxyHealth(node, card.proxyHealth);
  return node;
}

function render(data) {
  pollSeconds = Number(data.pollSeconds || 60);
  nextRefreshAt = Date.now() + pollSeconds * 1000;
  if (pollLabel) {
    pollLabel.textContent =
      pollSeconds >= 60 && pollSeconds % 60 === 0
        ? `${pollSeconds / 60} 分钟轮询`
        : `${pollSeconds} 秒轮询`;
  }
  setOverall(data.overall);
  normalCount.textContent = `${data.normalCount} 正常`;
  totalCount.textContent = `${data.totalCount} 个配置`;
  updatedAt.textContent = formatUpdatedAt(data.generatedAt);
  renderNotice(data.cards || []);
  cardsEl.replaceChildren(...(data.cards || []).map(renderCard));
  updateCountdown();
}

async function load() {
  refreshButton.disabled = true;
  try {
    const response = await fetch(`/custom-status/api/summary?range=${activeRange}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    cardsEl.innerHTML = `<div class="notice">状态数据读取失败：${String(error)}</div>`;
    setOverall("unknown");
    updatedAt.textContent = "更新于 --";
  } finally {
    refreshButton.disabled = false;
  }
}

function updateCountdown() {
  const remaining = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
  document.querySelectorAll(".next-update").forEach((el) => {
    el.textContent = `◷ NEXT UPDATE IN ${remaining}S`;
  });
  if (remaining <= 0) load();
}

document.querySelectorAll(".range").forEach((button) => {
  button.addEventListener("click", () => {
    activeRange = Number(button.dataset.range || 7);
    document.querySelectorAll(".range").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    load();
  });
});

refreshButton.addEventListener("click", load);

countdownTimer = setInterval(updateCountdown, 1000);
window.addEventListener("beforeunload", () => {
  if (countdownTimer) clearInterval(countdownTimer);
});

load();
