import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import path from "path";

import { cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, isCacheUpToDate, CARGO_HOME } from "./config";

process.on("uncaughtException", (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

const EXCLUDE_FILE = ".manifest-exclude.txt"

async function run() {
  const save = core.getInput("save-if").toLowerCase() || "true";

  if (!(cache.isFeatureAvailable() && save === "true")) {
    return;
  }

  try {
    if (isCacheUpToDate()) {
      core.info(`Cache up-to-date.`);
      return;
    }

    const config = CacheConfig.fromState();
    config.printInfo();
    core.info("");

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
      const crates = core.getInput("cache-all-crates").toLowerCase() || "false"
      core.info(`... Cleaning cargo registry cache-all-crates: ${crates} ...`);
      await cleanRegistry(allPackages, crates !== "true");
    } catch (e) {
      core.error(`${(e as any).stack}`);
    }

    /*
    try {
      core.info(`... Cleaning cargo/bin ...`);
      await cleanBin(config.cargoBins);
    } catch (e) {
      core.error(`${(e as any).stack}`);
    }
    */

    try {
      core.info(`... Cleaning cargo git cache ...`);
      await cleanGit(allPackages);
    } catch (e) {
      core.error(`${(e as any).stack}`);
    }

    core.info(`... Saving cache ...`);
    const cachePaths: string[] = [];
    if (config.cargoBins.length != 0) {
      // Exclude cargo bins from the cache.
      const dir = path.join(CARGO_HOME, "bin");
      const data = config
        .cargoBins
        .map((file) => path.join(dir, file))
        .join("\n");
      fs.writeFileSync(EXCLUDE_FILE, data);
      cachePaths.push("--exclude-from="+EXCLUDE_FILE);
    }

    // Pass a copy of cachePaths to avoid mutating the original array as reported by:
    // https://github.com/actions/toolkit/pull/1378
    // TODO: remove this once the underlying bug is fixed.
    cachePaths.concat(config.cachePaths.slice());
    await cache.saveCache(cachePaths, config.cacheKey);

    if (fs.existsSync(EXCLUDE_FILE)) {
      fs.unlinkSync(EXCLUDE_FILE);
    }
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
