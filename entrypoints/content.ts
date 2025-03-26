export default defineContentScript({
  matches: ['https://*/*', 'http://*/*', '*://*/*'],
  main() {
    function getPageSource() {
      return new XMLSerializer().serializeToString(document)
    }

    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // console.log('收到消息', request)
      if (request.action === 'requestSource') {
        sendResponse({ action: 'responseSource', source: getPageSource() })
      }
    })
  },
})
