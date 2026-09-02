// Re-exported from the shared browser/server module so one class identity backs every `instanceof HubStoreError`
// check on the server while the Character Sheet can throw and catch the same errors in the browser.
export {HubStoreError} from "../../js/hub/hub-store-error.js";
