<script setup lang="ts">
// One renderer, four windows: the hash says which one this is. Read once, from location rather
// than a router, so a window never flashes another window's page (a marnis-app lesson).
import { onMounted } from 'vue'
import BubblePage from './pages/BubblePage.vue'
import HudPage from './pages/HudPage.vue'
import MerchantPage from './pages/MerchantPage.vue'
import PanelPage from './pages/PanelPage.vue'
import { useApp } from './stores/app.ts'

const page = location.hash.replace(/^#\/?/, '') || 'panel'
const store = useApp()
onMounted(() => void store.init())
</script>

<template>
  <BubblePage v-if="page === 'bubble'" />
  <HudPage v-else-if="page === 'hud'" />
  <MerchantPage v-else-if="page === 'merchant'" />
  <PanelPage v-else />
</template>
