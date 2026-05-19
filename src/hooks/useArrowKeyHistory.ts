import { useCallback, useRef, useState } from 'react';
import { getHistory } from '../history.js';
import type { HistoryEntry, PastedContent } from '../utils/config.js';

const HISTORY_CHUNK_SIZE = 10;

let pendingLoad: Promise<HistoryEntry[]> | null = null;
let pendingLoadTarget = 0;

async function loadHistoryEntries(minCount: number): Promise<HistoryEntry[]> {
  const target = Math.ceil(minCount / HISTORY_CHUNK_SIZE) * HISTORY_CHUNK_SIZE;

  if (pendingLoad && pendingLoadTarget >= target) {
    return pendingLoad;
  }

  if (pendingLoad) {
    await pendingLoad;
  }

  pendingLoadTarget = target;
  pendingLoad = (async () => {
    const entries: HistoryEntry[] = [];
    let loaded = 0;
    for await (const entry of getHistory()) {
      entries.push(entry);
      loaded++;
      if (loaded >= pendingLoadTarget) break;
    }
    return entries;
  })();

  try {
    return await pendingLoad;
  } finally {
    pendingLoad = null;
    pendingLoadTarget = 0;
  }
}

export function useArrowKeyHistory(
  onChange: (value: string) => void,
  setPastedContents: React.Dispatch<React.SetStateAction<Record<number, PastedContent>>>,
  currentInput: string,
  pastedContents: Record<number, PastedContent>,
) {
  const [historyIndex, setHistoryIndex] = useState(0);
  const [draftEntry, setDraftEntry] = useState<HistoryEntry | undefined>(undefined);

  const historyCache = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(0);

  // Keep refs in sync with props for async closure access
  const currentInputRef = useRef(currentInput);
  const pastedContentsRef = useRef(pastedContents);
  currentInputRef.current = currentInput;
  pastedContentsRef.current = pastedContents;

  const onHistoryUp = useCallback(() => {
    const targetIndex = historyIndexRef.current;
    historyIndexRef.current++;

    // Save current draft on first arrow press
    if (targetIndex === 0) {
      const inputAtPress = currentInputRef.current;
      if (inputAtPress.trim() !== '') {
        setDraftEntry({
          display: inputAtPress,
          pastedContents: pastedContentsRef.current,
        });
      } else {
        setDraftEntry(undefined);
      }
    }

    void (async () => {
      const neededCount = targetIndex + 1;

      if (historyCache.current.length < neededCount) {
        const entries = await loadHistoryEntries(neededCount);
        if (entries.length > historyCache.current.length) {
          historyCache.current = entries;
        }
      }

      if (targetIndex >= historyCache.current.length) {
        historyIndexRef.current--;
        return;
      }

      const entry = historyCache.current[targetIndex];
      setHistoryIndex(targetIndex + 1);
      onChange(entry.display);
      setPastedContents(entry.pastedContents ?? {});
    })();
  }, [onChange, setPastedContents]);

  const onHistoryDown = useCallback((): boolean => {
    const currentIndex = historyIndexRef.current;
    if (currentIndex > 1) {
      historyIndexRef.current--;
      setHistoryIndex(currentIndex - 1);
      const entry = historyCache.current[currentIndex - 2];
      onChange(entry.display);
      setPastedContents(entry.pastedContents ?? {});
    } else if (currentIndex === 1) {
      historyIndexRef.current = 0;
      setHistoryIndex(0);
      if (draftEntry) {
        onChange(draftEntry.display);
        setPastedContents(draftEntry.pastedContents ?? {});
      } else {
        onChange('');
        setPastedContents({});
      }
    }
    return currentIndex <= 0;
  }, [onChange, setPastedContents, draftEntry]);

  const resetHistory = useCallback(() => {
    setDraftEntry(undefined);
    setHistoryIndex(0);
    historyIndexRef.current = 0;
  }, []);

  return {
    historyIndex,
    onHistoryUp,
    onHistoryDown,
    resetHistory,
  };
}