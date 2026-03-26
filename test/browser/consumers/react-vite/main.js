import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { captureConsumerError, runConsumerScenario } from "../shared.js";

function App() {
  useEffect(() => {
    void runConsumerScenario({ bundler: "vite", framework: "react" }).catch(captureConsumerError);
  }, []);

  return React.createElement("main", { id: "app-root" }, "react vite consumer");
}

createRoot(document.getElementById("app")).render(React.createElement(App));
