/**
 * The Black Cloud Merchant's pets worth buying: from the stock of the tabs opened (main keeps the
 * latest of each until its restock time), the "Pet: <name>" and "Soul: <name>" items whose pet is
 * not at the cap. A pet item unlocks a pet you do not have yet, and gives one soul otherwise; a
 * soul item gives one soul. Items are matched to pets by petItems.json (scripts/fetch-pet-items.mjs),
 * which the caller passes in (this file imports types only, so the tests can run it).
 */
import { MAX_LEVEL, type ShopStock } from '../../../shared/tracker.ts'

export interface MerchantOffer {
  pet: number
  /** What buying does: unlock the pet, or add one soul to it. */
  gives: 'unlock' | 'soul'
  price: number
  base: number
  /** Percent off the base price, rounded. */
  discount: number
}

export interface ItemTable {
  pets: Record<string, number>
  souls: Record<string, number>
}

/**
 * The offers worth buying, best first: pets you do not have yet, then by the biggest discount.
 * `level(pet)` is the pet's level, or null for a pet the collection has never seen.
 */
export function merchantOffers(
  stocks: ShopStock[],
  level: (pet: number) => number | null,
  now: number,
  table: ItemTable,
): MerchantOffer[] {
  const best = new Map<number, MerchantOffer>()
  for (const stock of stocks) {
    if (stock.nextAt !== null && stock.nextAt <= now) continue // restocked since
    for (const it of stock.items) {
      const petItem = table.pets[String(it.item)]
      const pet = petItem ?? table.souls[String(it.item)]
      if (pet === undefined) continue
      const lv = level(pet)
      if (lv !== null && lv >= MAX_LEVEL) continue
      const offer: MerchantOffer = {
        pet,
        gives: petItem !== undefined && (lv === null || lv === 0) ? 'unlock' : 'soul',
        price: it.price,
        base: it.base,
        discount: it.base > 0 ? Math.round((1 - it.price / it.base) * 100) : 0,
      }
      const seen = best.get(pet)
      if (!seen || offer.price < seen.price) best.set(pet, offer)
    }
  }
  return [...best.values()].sort(
    (a, b) => Number(b.gives === 'unlock') - Number(a.gives === 'unlock') || b.discount - a.discount || a.price - b.price,
  )
}
