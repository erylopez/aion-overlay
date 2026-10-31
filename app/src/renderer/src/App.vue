<script setup lang="ts">
// One renderer, sixteen windows: the hash says which one this is. Read once, from location rather
// than a router, so a window never flashes another window's page (a marnis-app lesson).
import { onMounted } from 'vue'
import BubblePage from './pages/BubblePage.vue'
import BuffsPage from './pages/BuffsPage.vue'
import CcPage from './pages/CcPage.vue'
import EnemiesPage from './pages/EnemiesPage.vue'
import TrainingPage from './pages/TrainingPage.vue'
import DetailsPage from './pages/DetailsPage.vue'
import GameMapPage from './pages/GameMapPage.vue'
import RegionPickPage from './pages/RegionPickPage.vue'
import HudPage from './pages/HudPage.vue'
import KillFeedPage from './pages/KillFeedPage.vue'
import MerchantPage from './pages/MerchantPage.vue'
import MeterPage from './pages/MeterPage.vue'
import MiniMapPage from './pages/MiniMapPage.vue'
import SkillsPage from './pages/SkillsPage.vue'
import TimerBarPage from './pages/TimerBarPage.vue'
import PacketsPage from './pages/PacketsPage.vue'
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
  <MeterPage v-else-if="page === 'meter'" />
  <KillFeedPage v-else-if="page === 'killfeed'" />
  <TimerBarPage v-else-if="page === 'timerbar'" />
  <DetailsPage v-else-if="page === 'details'" />
  <SkillsPage v-else-if="page === 'skills'" />
  <MiniMapPage v-else-if="page === 'minimap'" />
  <BuffsPage v-else-if="page === 'buffs'" />
  <CcPage v-else-if="page === 'cc'" />
  <EnemiesPage v-else-if="page === 'enemies'" />
  <TrainingPage v-else-if="page === 'training'" />
  <PacketsPage v-else-if="page === 'packets'" />
  <GameMapPage v-else-if="page === 'gamemap'" />
  <RegionPickPage v-else-if="page === 'regionpick'" />
  <PanelPage v-else />
</template>
