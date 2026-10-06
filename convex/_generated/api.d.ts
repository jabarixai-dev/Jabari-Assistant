/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentActions from "../agentActions.js";
import type * as agentChat from "../agentChat.js";
import type * as agentCopilot from "../agentCopilot.js";
import type * as agentSettings from "../agentSettings.js";
import type * as agentTools from "../agentTools.js";
import type * as analytics from "../analytics.js";
import type * as anonymousSession from "../anonymousSession.js";
import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as bookings from "../bookings.js";
import type * as campaigns from "../campaigns.js";
import type * as chatGeneration from "../chatGeneration.js";
import type * as companies from "../companies.js";
import type * as contacts from "../contacts.js";
import type * as conversationFeed from "../conversationFeed.js";
import type * as crmSearch from "../crmSearch.js";
import type * as emailBrand from "../emailBrand.js";
import type * as googleSearch from "../googleSearch.js";
import type * as http from "../http.js";
import type * as landingPages from "../landingPages.js";
import type * as leadForms from "../leadForms.js";
import type * as leads from "../leads.js";
import type * as opportunities from "../opportunities.js";
import type * as outreach from "../outreach.js";
import type * as outreachMetrics from "../outreachMetrics.js";
import type * as research from "../research.js";
import type * as reviews from "../reviews.js";
import type * as serpApiSearch from "../serpApiSearch.js";
import type * as workflowTasks from "../workflowTasks.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentActions: typeof agentActions;
  agentChat: typeof agentChat;
  agentCopilot: typeof agentCopilot;
  agentSettings: typeof agentSettings;
  agentTools: typeof agentTools;
  analytics: typeof analytics;
  anonymousSession: typeof anonymousSession;
  appointments: typeof appointments;
  auth: typeof auth;
  billing: typeof billing;
  bookings: typeof bookings;
  campaigns: typeof campaigns;
  chatGeneration: typeof chatGeneration;
  companies: typeof companies;
  contacts: typeof contacts;
  conversationFeed: typeof conversationFeed;
  crmSearch: typeof crmSearch;
  emailBrand: typeof emailBrand;
  googleSearch: typeof googleSearch;
  http: typeof http;
  landingPages: typeof landingPages;
  leadForms: typeof leadForms;
  leads: typeof leads;
  opportunities: typeof opportunities;
  outreach: typeof outreach;
  outreachMetrics: typeof outreachMetrics;
  research: typeof research;
  reviews: typeof reviews;
  serpApiSearch: typeof serpApiSearch;
  workflowTasks: typeof workflowTasks;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
