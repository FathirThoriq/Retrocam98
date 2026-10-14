'use strict';
/* RetroCam 98 — service worker: koordinasi Studio (side panel) dan tab Meet. */

const MEET_KEY = 'rc98:meetPreset';

// Popup tetap jadi pintu masuk ikon; Studio dibuka lewat pesan dari popup.
try {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => {});
} catch (e) { /* sidePanel tidak tersedia: Studio tetap bisa dibuka sebagai tab */ }

function notifyMeetTabs() {
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    for (const tab of tabs || []) {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'rc98-preset-updated' }, () => {
          void chrome.runtime.lastError; // tab tanpa bridge diabaikan saja
        });
      } catch (e) { /* abaikan */ }
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[MEET_KEY]) notifyMeetTabs();
});

async function openStudio(tabId) {
  const openTab = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
  };
  try {
    if (tabId != null && chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ tabId });
      return;
    }
    throw new Error('sidePanel tidak tersedia');
  } catch (e) {
    openTab();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'rc98-open-studio') {
    const senderTabId = sender && sender.tab && sender.tab.id;
    if (senderTabId != null) {
      openStudio(senderTabId).then(() => sendResponse({ ok: true }));
      return true; // respons asinkron
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs && tabs[0] && tabs[0].id;
      openStudio(id).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
  return false;
});
