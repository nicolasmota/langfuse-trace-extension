SHELL := /bin/bash
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DEV_WORKSPACE := $(ROOT)/.dev-host-workspace
NPM ?= npm
VERSION := $(shell node -p "require('$(ROOT)/package.json').version")
VSIX := $(ROOT)/langfuse-traces-$(VERSION).vsix
EXT_ID := nicolasmota.langfuse-traces

# Prefer Cursor when available; override with: make dev IDE=code
IDE ?= $(shell command -v cursor >/dev/null 2>&1 && echo cursor || echo code)

.DEFAULT_GOAL := help

.PHONY: help setup install-deps deps build compile watch test check clean rebuild package install-local uninstall-local dev dev-watch verify doctor

help: ## Show available commands
	@printf "\nLangfuse Traces — local development\n\n"
	@grep -E '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@printf "\nRecommended workflow:\n"
	@printf "  1) make setup           # first time\n"
	@printf "  2) make dev             # open extension development host\n"
	@printf "     or make install-local # install .vsix in current Cursor/VS Code window\n\n"
	@printf "Detected IDE: %s (override: make dev IDE=code)\n\n" "$(IDE)"

setup: install-deps build test ## Install dependencies, compile, and run tests
	@printf "Setup complete. Run: make dev\n"

install-deps deps: ## Install npm dependencies
	$(NPM) install

build compile: ## Compile TypeScript to out/
	$(NPM) run compile
	@test -f "$(ROOT)/out/extension.js" || (echo "Error: out/extension.js was not generated." && exit 1)

watch: ## Compile in watch mode (foreground)
	$(NPM) run watch

test: ## Run the test suite
	$(NPM) test

check: build test ## Compile and run tests (handy for local CI)

verify: build ## Verify main build artifacts exist
	@test -f "$(ROOT)/out/extension.js"
	@test -f "$(ROOT)/out/mcp/server.js"
	@test -f "$(ROOT)/out/mcp/stdio-main.js"
	@printf "OK: artifacts in out/\n"

doctor: ## Diagnostics when the extension does not show up
	@printf "\n=== Langfuse Traces — diagnostics ===\n\n"
	@printf "1) Compiled artifacts\n"
	@if [ -f "$(ROOT)/out/extension.js" ]; then printf "   OK  out/extension.js\n"; else printf "   FAIL — run: make build\n"; fi
	@printf "\n2) Editor CLI (IDE=%s)\n" "$(IDE)"
	@if command -v "$(IDE)" >/dev/null 2>&1; then printf "   OK  %s\n" "$$(command -v $(IDE))"; else printf "   FAIL — cursor/code not on PATH\n"; fi
	@printf "\n3) Extension installed in %s\n" "$(IDE)"
	@if command -v "$(IDE)" >/dev/null 2>&1 && "$(IDE)" --list-extensions 2>/dev/null | grep -q "$(EXT_ID)"; then \
		printf "   OK  $(EXT_ID) installed\n"; \
	else \
		printf "   —   not installed (normal if you only use make dev)\n"; \
		printf "       to install: make install-local\n"; \
	fi
	@printf "\n4) About Extension Host logs\n"
	@printf "   - Snyk errors (Stopping the server timed out) come from another extension; ignore them.\n"
	@printf "   - Langfuse only appears in the log AFTER activation (sidebar icon or command).\n"
	@printf "   - Each Cursor window has its own Extension Host.\n"
	@printf "     make dev opens a NEW window (.dev-host-workspace) — check Output there.\n"
	@printf "\n5) Activate manually\n"
	@printf "   Cmd+Shift+P → \"Langfuse: Open Trace by Session ID…\"\n"
	@printf "   or click the Langfuse icon in the Activity Bar (left sidebar)\n"
	@printf "\n6) See running extensions\n"
	@printf "   Cmd+Shift+P → \"Developer: Show Running Extensions\"\n"
	@printf "   look for: $(EXT_ID)\n"
	@printf "\n7) MCP server (Cursor chat)\n"
	@if [ -f "$(ROOT)/out/mcp/stdio-main.js" ]; then printf "   OK  out/mcp/stdio-main.js\n"; else printf "   FAIL — run: make build\n"; fi
	@printf "   After activation: Cursor Settings → MCP → enable **langfuse-traces**\n"
	@printf "   Or run: Langfuse: Register MCP Server\n\n"

clean: ## Remove out/, .vsix, and build artifacts
	rm -rf "$(ROOT)/out"
	rm -f "$(ROOT)"/*.vsix

rebuild: clean build ## Clean and recompile

package: build ## Build langfuse-traces-<version>.vsix
	npx @vscode/vsce package --out "$(VSIX)"
	@printf "VSIX created: %s\n" "$(VSIX)"

install-local: package ## Install .vsix in current Cursor/VS Code window
	@if ! command -v "$(IDE)" >/dev/null 2>&1; then \
		echo "Error: '$(IDE)' not found on PATH."; exit 1; \
	fi
	"$(IDE)" --install-extension "$(VSIX)" --force
	@printf "\nInstalled. Reload the window: Cmd+Shift+P → Developer: Reload Window\n"
	@printf "Then look for the Langfuse icon in the Activity Bar or run: Langfuse: Open Trace by Session ID…\n"

uninstall-local: ## Uninstall the locally installed extension
	@if ! command -v "$(IDE)" >/dev/null 2>&1; then \
		echo "Error: '$(IDE)' not found on PATH."; exit 1; \
	fi
	"$(IDE)" --uninstall-extension "$(EXT_ID)"

dev: build ## Compile and open Extension Development Host ($(IDE))
	@if ! command -v "$(IDE)" >/dev/null 2>&1; then \
		echo "Error: '$(IDE)' not found on PATH."; exit 1; \
	fi
	@mkdir -p "$(DEV_WORKSPACE)"
	@printf "Opening a NEW Extension Development Host window (%s)...\n" "$(IDE)"
	@printf "Test workspace: .dev-host-workspace (does not reuse this window).\n"
	@printf "Look for the Langfuse icon in the Activity Bar or run: Langfuse: Open Trace by Session ID…\n"
	"$(IDE)" -n --extensionDevelopmentPath="$(ROOT)" "$(DEV_WORKSPACE)"

dev-watch: build ## Watch-compile and open Extension Development Host
	@if ! command -v "$(IDE)" >/dev/null 2>&1; then \
		echo "Error: '$(IDE)' not found on PATH."; exit 1; \
	fi
	@mkdir -p "$(DEV_WORKSPACE)"
	@printf "Background watch + Extension Development Host (%s)\n" "$(IDE)"
	$(NPM) run watch & \
	WATCH_PID=$$!; \
	trap 'kill $$WATCH_PID 2>/dev/null || true' EXIT; \
	"$(IDE)" -n --extensionDevelopmentPath="$(ROOT)" "$(DEV_WORKSPACE)"; \
	wait $$WATCH_PID 2>/dev/null || true
