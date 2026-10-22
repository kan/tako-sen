<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { portalUrl } from "./auth";
import { loadLicenses, type LicenseEntry, type LicenseUse } from "./licenses";

/**
 * The body of the About dialog, the same as vegtab's About page and licences
 * page (vegtab frontend/src/views/AboutView.vue, LicensesView.vue). The
 * portal's icon is loaded from the portal itself, so a redrawn icon there
 * shows here too.
 */
const portalTop = portalUrl("/");
const portalIcon = portalUrl("/favicon.svg");
const termsUrl = portalUrl("/terms");
const privacyUrl = portalUrl("/privacy");
// Offline or with the portal down, the link stays without an empty frame.
const portalIconFailed = ref(false);

const useLabels: Record<LicenseUse, string> = {
  app: "画面",
  sw: "オフライン対応",
  server: "サーバー",
};
const listFormat = new Intl.ListFormat("ja", { type: "conjunction" });
function usedInText(entry: LicenseEntry): string {
  return listFormat.format(entry.usedIn.map((use) => useLabels[use]));
}

const licenses = ref<LicenseEntry[]>();
const licensesFailed = ref(false);
onMounted(async () => {
  try {
    licenses.value = await loadLicenses();
  } catch {
    licensesFailed.value = true;
  }
});

// The texts together are over 100 kB, so only the opened ones are rendered.
const openTexts = reactive(new Set<string>());
function keyOf(entry: LicenseEntry): string {
  return `${entry.name}@${entry.version}`;
}
function toggleText(entry: LicenseEntry, event: Event): void {
  if ((event.target as HTMLDetailsElement).open) openTexts.add(keyOf(entry));
  else openTexts.delete(keyOf(entry));
}
</script>

<template>
  <section class="about-section" aria-labelledby="about-portal-title">
    <h3 id="about-portal-title">
      <a
        class="about-portal-link"
        :href="portalTop"
        target="_blank"
        rel="noopener"
      >
        <img
          v-if="!portalIconFailed"
          class="about-portal-icon"
          :src="portalIcon"
          alt=""
          width="28"
          height="28"
          draggable="false"
          @error="portalIconFailed = true"
        />
        kan-game.app
      </a>
    </h3>
    <p>
      TAKO-SEN は kan-game.app のゲームです。ID、名前、退会は kan-game.app
      のゲームで共通です。
    </p>
    <ul class="about-links">
      <li>
        <a :href="termsUrl" target="_blank" rel="noopener">利用規約</a>
      </li>
      <li>
        <a :href="privacyUrl" target="_blank" rel="noopener"
          >プライバシーポリシー</a
        >
      </li>
    </ul>
  </section>
  <section class="about-section" aria-labelledby="about-licenses-title">
    <h3 id="about-licenses-title">オープンソースのライセンス</h3>
    <p>TAKO-SEN は次のオープンソースのソフトウェアを使っています。</p>
    <p v-if="licensesFailed" role="status">一覧を読み込めませんでした。</p>
    <ul v-else-if="licenses" class="license-list">
      <li v-for="entry in licenses" :key="keyOf(entry)" class="license-item">
        <div class="license-head">
          <a
            v-if="entry.url"
            class="license-name"
            :href="entry.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ entry.name }}</a
          >
          <span v-else class="license-name">{{ entry.name }}</span>
          <span class="license-version">{{ entry.version }}</span>
        </div>
        <p class="license-meta">
          {{ entry.license }} ・ {{ usedInText(entry) }}で使用
        </p>
        <details v-if="entry.text" @toggle="toggleText(entry, $event)">
          <summary>ライセンスの全文</summary>
          <pre v-if="openTexts.has(keyOf(entry))" class="license-text">{{
            entry.text
          }}</pre>
        </details>
        <!-- Some packages do not ship their licence file; their repository has it. -->
        <p v-else-if="entry.url" class="license-meta">
          ライセンスの全文は、名前のリンク先のリポジトリにあります。
        </p>
      </li>
    </ul>
  </section>
</template>
