/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Native Query constructor/start/cancel from the validated pre-change engine.
// Source SHA256: d994e2253294eaddebc159faf106127707158833d9de092f6a39ca6ccd4df34e
// The test replaces only the reviewed dispatch gate with the product patch.
export class Query {
  /**
   * Initializes the query object.
   *
   * @param {UrlbarQueryContext} queryContext
   *   The query context.
   * @param {?UrlbarParentController} controller
   *   The controller to be notified. May be null.
   * @param {UrlbarMuxer} muxer
   *   The muxer to sort results.
   * @param {UrlbarProvider[]} providers
   *   Array of all the providers.
   */
  constructor(queryContext, controller, muxer, providers) {
    this.context = queryContext;
    this.context.results = [];
    // Clear any state in the context object, since it could be reused by the
    // caller and we don't want to port previous query state over.
    this.context.pendingHeuristicProviders.clear();
    this.context.deferUserSelectionProviders.clear();
    this.unsortedResults = [];
    this.muxer = muxer;
    this.controller = controller;
    this.providers = providers;
    this.started = false;
    this.canceled = false;

    // This is used as a last safety filter in add(), thus we keep an unmodified
    // copy of it.
    this.acceptableSources = queryContext.sources.slice();
  }

  /**
   * Starts querying.
   */
  async start() {
    if (this.started) {
      throw new Error("This Query has been started already");
    }
    this.started = true;

    // Check which providers should be queried by calling isActive on them.
    let activeProviders = [];
    let activePromises = [];
    let maxPriority = -1;
    for (let provider of this.providers) {
      // This can be used by the provider to check the query is still running
      // after executing async tasks:
      //   let instance = this.queryInstance;
      //   await ...
      //   if (instance != this.queryInstance) {
      //     // Query was canceled or a new one started.
      //     return;
      //   }
      provider.queryInstance = this;
      activePromises.push(
        provider
          .isActive(this.context, this.controller)
          .then(isActive => {
            if (isActive && !this.canceled) {
              let priority = provider.tryMethod("getPriority", this.context);
              if (priority >= maxPriority) {
                // The provider's priority is at least as high as the max.
                if (priority > maxPriority) {
                  // The provider's priority is higher than the max.  Remove all
                  // previously added providers, since their priority is
                  // necessarily lower, by setting length to zero.
                  activeProviders.length = 0;
                  maxPriority = priority;
                }
                activeProviders.push(provider);
                if (provider.deferUserSelection) {
                  this.context.deferUserSelectionProviders.add(provider.name);
                }
              }
            }
          })
          .catch(ex => lazy.logger.error(ex))
      );
    }

    // We have to wait for all isActive calls to finish because we want to query
    // only the highest priority active providers as determined by the priority
    // logic above.
    await Promise.all(activePromises);

    if (this.canceled) {
      this.controller = null;
      return;
    }

    // Start querying active providers.
    /**
     * @type {(provider: UrlbarProvider) => Promise<void>}
     */
    let startQuery = async provider => {
      provider.logger.debug(
        `Starting query for "${this.context.searchString}"`
      );
      let addedResult = false;
      await provider.tryMethod(
        "startQuery",
        this.context,
        /** @type {Parameters<UrlbarProvider['startQuery']>[1]} */
        (innerProvider, result) => {
          addedResult = true;
          this.add(innerProvider, result);
        },
        this.controller
      );
      if (!addedResult) {
        this.context.deferUserSelectionProviders.delete(provider.name);
      }
    };

    let queryPromises = [];
    for (let provider of activeProviders) {
      // Track heuristic providers. later we'll use this Set to wait for them
      // before returning results to the user.
      if (provider.type == lazy.UrlbarShared.PROVIDER_TYPE.HEURISTIC) {
        this.context.pendingHeuristicProviders.add(provider.name);
        queryPromises.push(
          startQuery(provider).finally(() => {
            this.context.pendingHeuristicProviders.delete(provider.name);
          })
        );
        continue;
      }
      if (
        provider.name === "ZenUrlbarProviderRecentTabs" &&
        !this.context.searchString.trim()
      ) {
        // An explicitly opened local preview has no typed input to debounce.
        // Keep its PROFILE classification and normal priority/cancellation
        // rules, but do not retain the preceding view for the typing delay.
        queryPromises.push(startQuery(provider));
        continue;
      }
      if (!this._sleepTimer) {
        // Tracks the delay timer. We will fire (in this specific case, cancel
        // would do the same, since the callback is empty) the timer when the
        // search is canceled, unblocking start().
        this._sleepTimer = new lazy.SkippableTimer({
          name: "Query provider timer",
          time: lazy.UrlbarPrefs.get("delay"),
          logger: provider.logger,
        });
      }
      queryPromises.push(
        this._sleepTimer.promise.then(() =>
          this.canceled ? undefined : startQuery(provider)
        )
      );
    }

    lazy.logger.info(
      `Queried ${queryPromises.length} providers: ${activeProviders.map(
        p => p.name
      )}`
    );

    // Normally we wait for all the queries, but in case this is canceled we can
    // return earlier.
    let cancelPromise = new Promise(resolve => {
      this._cancelQueries = resolve;
    });
    await Promise.race([Promise.all(queryPromises), cancelPromise]);

    // All the providers are done returning results, so we can stop chunking.
    if (!this.canceled) {
      await this._chunkTimer?.fire();
    }

    // Break cycles with the controller to avoid leaks.
    this.controller = null;
  }

  /**
   * Cancels this query. Note: Invoking cancel multiple times is a no-op.
   */
  cancel() {
    if (this.canceled) {
      return;
    }
    this.canceled = true;
    this.context.deferUserSelectionProviders.clear();
    for (let provider of this.providers) {
      provider.logger.debug(
        `Canceling query for "${this.context.searchString}"`
      );
      // Mark the instance as no more valid, see start() for details.
      provider.queryInstance = null;
      provider.tryMethod("cancelQuery", this.context);
    }
    this._chunkTimer?.cancel().catch(ex => lazy.logger.error(ex));
    this._sleepTimer?.fire().catch(ex => lazy.logger.error(ex));
    this._cancelQueries?.();
  }

}
