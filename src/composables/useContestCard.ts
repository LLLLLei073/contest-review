import { ref } from 'vue';
import { downloadContestCard, type ContestCardInput } from '../contest-card';

// Card download wrapper shared by the three report components: the options are
// platform-specific, the error surface and guard are not.
export function useContestCard() {
  const cardError = ref('');
  async function downloadCard(input: ContestCardInput | null | undefined) {
    if (!input) return;
    cardError.value = '';
    try {
      await downloadContestCard(input);
    } catch (e) {
      cardError.value = (e as Error).message;
    }
  }
  return { cardError, downloadCard };
}
