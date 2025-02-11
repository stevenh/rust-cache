import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, STATE_KEY } from "./config";

process.on("uncaughtException", (e) => {
  core.info(`[warning] ${e.message}`);
  if (e.stack) {
    core.info(e.stack);
  }
});

async function run() {
  const save = core.getInput("save-if").toLowerCase() || "true";

  if (!(cache.isFeatureAvailable() && save === "true")) {
    return;
  }

  try {
    const config = await CacheConfig.new();
    config.printInfo();
    core.info("");

    if (core.getState(STATE_KEY) === config.cacheKey) {
      core.info(`Cache up-to-date.`);
      return;
    }

    // TODO: remove this once https://github.com/actions/toolkit/pull/553 lands
    await macOsWorkaround();

    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackages();
      allPackages.push(...packages);
      try {
        core.info(`... Cleaning ${workspace.target} ...`);
        await cleanTargetDir(workspace.target, packages);
      } catch (e) {
        core.error(`${(e as any).stack}`);
      }
    }

    try {
      const creates = core.getInput("cache-all-crates").toLowerCase() || "false";
      core.info(`... Cleaning cargo registry cache-all-crates: ${creates} ...`);
      await cleanRegistry(allPackages, creates === "true");
    } catch (e) {
      core.error(`${(e as any).stack}`);
    }

    try {
      core.info(`... Cleaning cargo/bin ...`);
      await cleanBin();
    } catch (e) {
      core.error(`${(e as any).stack}`);
    }

    try {
      core.info(`... Cleaning cargo git cache ...`);
      await cleanGit(allPackages);
    } catch (e) {
      core.error(`${(e as any).stack}`);
    }

    core.info(`... Saving cache ...`);
    // Pass a copy of cachePaths to avoid mutating the original array as reported by:
    // https://github.com/actions/toolkit/pull/1378
    // TODO: remove this once the underlying bug is fixed.
    await cache.saveCache(config.cachePaths.slice(), config.cacheKey);
  } catch (e) {
    core.error(`${(e as any).stack}`);
  }
}

run();

async function macOsWorkaround() {
  try {
    // Workaround for https://github.com/actions/cache/issues/403
    // Also see https://github.com/rust-lang/cargo/issues/8603
    await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
  } catch {}
}
