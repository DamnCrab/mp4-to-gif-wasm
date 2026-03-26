import { createApp, h, onMounted } from "vue";

import { captureConsumerError, runConsumerScenario } from "../shared.js";

createApp({
  setup() {
    onMounted(() => {
      void runConsumerScenario({ bundler: "vite", framework: "vue" }).catch(captureConsumerError);
    });

    return () => h("main", { id: "app-root" }, "vue vite consumer");
  }
}).mount("#app");
