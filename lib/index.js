import { RpcId } from "@deepseek-ai/dsh-host-apiproxy";
import { Service } from "@deepseek-ai/cordis";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import s from "@deepseek-ai/schemastery";
import { AttachmentError } from "@deepseek-ai/dsh-attachment";
import { SessionId, snapshotJsonValue } from "@deepseek-ai/dsh-session";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { deepFreeze } from "@deepseek-ai/dsh-llm";
//#region lib/types/host/session-types.js
/** Client-safe task-board Session request and result vocabulary. @module @deepseek-ai/dsh-task-board-session/types */
/**
* Brand a task-board Session request id.
* @param id - Opaque request identity.
* @returns The same string with its task-board Session request brand.
*/
function TaskBoardSessionRequestId(id) {
	return id;
}
//#endregion
//#region lib/types/host/session.js
/** Task-board Session admission capability. @module @deepseek-ai/dsh-task-board-session */
/** Provider-neutral Session admission service consumed by the task board. */
var TaskBoardSessionGateway = class extends Service {
	/**
	* Bind one provider to `ctx.taskBoardSession`.
	* @param ctx - Cordis context owning the provider.
	*/
	constructor(ctx) {
		super(ctx, "taskBoardSession");
	}
};
//#endregion
//#region lib/types/host/session-apiproxy.js
/** ApiProxy provider for task-board Session admission. @module @deepseek-ai/dsh-task-board-session-apiproxy */
function failure(error) {
	return {
		code: error.code,
		message: error.message
	};
}
/** Task-board Session provider backed by the Host's ordinary ApiProxy methods. */
var ApiProxyTaskBoardSessionGateway = class extends TaskBoardSessionGateway {
	static inject = ["apiProxy"];
	/** @inheritdoc */
	async create(request) {
		const response = await this.ctx.apiProxy.sessions.create({
			rpcId: RpcId(request.requestId),
			payload: {
				sessionId: request.sessionId,
				...request.workspaceId === void 0 ? {} : { workspaceId: request.workspaceId },
				...request.cwd === void 0 ? {} : { cwd: request.cwd },
				...request.agentPreset === void 0 ? {} : { agentPreset: request.agentPreset }
			}
		});
		if (!response.result.ok) return {
			ok: false,
			error: failure(response.result.error)
		};
		return {
			ok: true,
			value: { sessionId: response.result.value.sessionId }
		};
	}
	/** @inheritdoc */
	async prompt(request) {
		const content = request.content.map((part) => ({ ...part }));
		const response = await this.ctx.apiProxy.sessions.prompt({
			rpcId: RpcId(request.requestId),
			payload: {
				sessionId: request.sessionId,
				mode: "queue",
				content
			}
		});
		if (!response.result.ok) return {
			ok: false,
			error: failure(response.result.error)
		};
		return {
			ok: true,
			value: { accepted: true }
		};
	}
	/** @inheritdoc */
	async cancel(request) {
		const response = await this.ctx.apiProxy.sessions.cancel({
			rpcId: RpcId(request.requestId),
			payload: { sessionId: request.sessionId }
		});
		if (!response.result.ok) return {
			ok: false,
			error: failure(response.result.error)
		};
		return {
			ok: true,
			value: { accepted: true }
		};
	}
};
//#endregion
//#region lib/types/host/spec.js
/** Durable task-board Storage Domain declaration. @module @deepseek-ai/dsh-task-board/src/spec */
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const taskIdSchema = z.string().min(1).transform((value) => value);
const roundIdSchema = z.string().min(1).transform((value) => value);
const promptIdSchema = z.string().min(1).transform((value) => value);
const activityIdSchema = z.string().min(1).transform((value) => value);
const sessionIdSchema = z.string().min(1);
const workspaceIdSchema = z.string().min(1);
const rpcIdSchema = z.string().min(1);
const imageAttachmentRefSchema = z.object({
	attachmentId: z.string().min(1),
	mediaType: z.enum([
		"image/png",
		"image/jpeg",
		"image/webp",
		"image/gif"
	]),
	bytes: positiveInteger,
	width: positiveInteger,
	height: positiveInteger,
	name: z.string().optional()
});
const taskBoardStatusSchema = z.enum([
	"initialized",
	"running",
	"review",
	"done",
	"failed"
]);
const roundTriggerSchema = z.enum([
	"initial",
	"revision",
	"retry"
]);
/** Stable user-safe failure persisted with a task or terminal round. */
const taskBoardFailureSchema = z.object({
	stage: z.enum([
		"session-create",
		"prompt-admission",
		"execution",
		"recovery"
	]),
	code: z.string().min(1),
	message: z.string().min(1),
	turn: positiveInteger.optional(),
	seq: nonNegativeInteger.optional()
});
/** Durable board-originated prompt metadata. */
const taskBoardRoundPromptSchema = z.object({
	id: promptIdSchema,
	rpcId: rpcIdSchema,
	kind: z.enum([
		"initial",
		"feedback",
		"followup",
		"retry-continuation"
	]),
	text: z.string(),
	acceptedAt: nonNegativeInteger,
	messageSeq: nonNegativeInteger.optional(),
	turn: positiveInteger.optional(),
	turnEndSeq: nonNegativeInteger.optional()
});
/** Durable execution-round metadata linked to one Harness Session. */
const taskBoardRoundSchema = z.object({
	id: roundIdSchema,
	ordinal: positiveInteger,
	trigger: roundTriggerSchema,
	status: z.enum([
		"starting",
		"running",
		"completed",
		"failed",
		"cancelled"
	]),
	originStatus: z.enum([
		"initialized",
		"review",
		"failed"
	]),
	sessionId: sessionIdSchema,
	prompts: z.array(taskBoardRoundPromptSchema),
	startSeq: nonNegativeInteger.optional(),
	endSeq: nonNegativeInteger.optional(),
	startedAt: nonNegativeInteger,
	endedAt: nonNegativeInteger.optional(),
	feedback: z.string().optional(),
	failure: taskBoardFailureSchema.optional()
});
const activityBase = {
	id: activityIdSchema,
	at: nonNegativeInteger,
	actor: z.enum([
		"user",
		"agent",
		"system"
	])
};
/** Append-only task workflow history entry. */
const taskBoardActivitySchema = z.discriminatedUnion("operation", [
	z.object({
		...activityBase,
		operation: z.literal("created")
	}),
	z.object({
		...activityBase,
		operation: z.literal("edited"),
		fields: z.array(z.enum([
			"title",
			"description",
			"acceptanceCriteria",
			"workspaceId",
			"cwd",
			"agentPreset",
			"attachments"
		]))
	}),
	z.object({
		...activityBase,
		operation: z.literal("started"),
		roundId: roundIdSchema,
		trigger: roundTriggerSchema
	}),
	z.object({
		...activityBase,
		operation: z.literal("followup"),
		roundId: roundIdSchema,
		promptId: promptIdSchema
	}),
	z.object({
		...activityBase,
		operation: z.literal("transition"),
		from: taskBoardStatusSchema,
		to: taskBoardStatusSchema
	}),
	z.object({
		...activityBase,
		operation: z.literal("approved")
	}),
	z.object({
		...activityBase,
		operation: z.literal("rejected"),
		roundId: roundIdSchema,
		feedback: z.string().min(1)
	}),
	z.object({
		...activityBase,
		operation: z.literal("failed"),
		roundId: roundIdSchema,
		failure: taskBoardFailureSchema
	}),
	z.object({
		...activityBase,
		operation: z.literal("retried"),
		roundId: roundIdSchema
	}),
	z.object({
		...activityBase,
		operation: z.literal("reopened")
	}),
	z.object({
		...activityBase,
		operation: z.literal("automatic-title"),
		title: z.string()
	}),
	z.object({
		...activityBase,
		operation: z.literal("stopped"),
		roundId: roundIdSchema
	})
]);
/** Durable task card validator used on every Storage Domain read and write. */
const taskBoardTaskSchema = z.object({
	id: taskIdSchema,
	sequence: positiveInteger,
	identifier: z.string().min(1),
	revision: nonNegativeInteger,
	title: z.string(),
	titleMode: z.enum(["automatic", "manual"]),
	description: z.string(),
	acceptanceCriteria: z.string(),
	status: taskBoardStatusSchema,
	position: z.string().min(1),
	workspaceId: workspaceIdSchema.optional(),
	cwd: z.string().optional(),
	agentPreset: z.string().optional(),
	attachments: z.array(imageAttachmentRefSchema),
	currentSessionId: sessionIdSchema.optional(),
	rounds: z.array(taskBoardRoundSchema),
	activity: z.array(taskBoardActivitySchema),
	lastStartFailure: taskBoardFailureSchema.optional(),
	createdAt: nonNegativeInteger,
	updatedAt: nonNegativeInteger,
	completedAt: nonNegativeInteger.optional()
}).superRefine((task, context) => {
	if (task.workspaceId !== void 0 && task.cwd !== void 0) context.addIssue({
		code: "custom",
		message: "task may select a Workspace or cwd, not both",
		path: ["cwd"]
	});
});
/** Durable task-board singleton allocator and synchronization record. */
const taskBoardGlobalSchema = z.object({
	nextSequence: positiveInteger,
	boardRevision: nonNegativeInteger
});
/** Task-board Storage Domain version zero with one task table. */
const taskBoardDomainSpec = defineDomain({
	name: "task_board",
	version: 0,
	global: {
		schema: taskBoardGlobalSchema,
		initial: {
			nextSequence: 1,
			boardRevision: 0
		}
	},
	tables: { tasks: domainTable(taskBoardTaskSchema) }
});
//#endregion
//#region lib/types/host/state.js
/** Pure task-board workflow, ordering, prompt, and snapshot helpers. @module @deepseek-ai/dsh-task-board/src/state */
const POSITION_STEP = 1e6;
const POSITION_WIDTH = 16;
const STATUS_RANK = {
	initialized: 0,
	running: 1,
	review: 2,
	done: 3,
	failed: 4
};
/* v8 ignore next -- closed same-process unions make this diagnostic unreachable. */
function assertNever(value, subject) {
	throw new Error(`unexpected ${subject}: ${String(value)}`);
}
/** Expected pure workflow rejection raised before a durable mutation. */
var TaskBoardStateError = class extends Error {
	name = "TaskBoardStateError";
};
function stateError(message) {
	return new TaskBoardStateError(`task-board ${message}`);
}
function requireTransition(task, status, operation) {
	if (task.status !== status) throw stateError(`invalid transition: cannot ${operation} from ${task.status}`);
}
function derivedActivityId(id, suffix) {
	return `${id}:${suffix}`;
}
function freezeTask(task) {
	const snapshot = snapshotJsonValue(task);
	if (snapshot === void 0) throw stateError("task is not losslessly JSON serializable");
	return deepFreeze(snapshot);
}
function freezeSnapshot(snapshot) {
	const value = snapshotJsonValue(snapshot);
	if (value === void 0) throw stateError("snapshot is not losslessly JSON serializable");
	return deepFreeze(value);
}
function nextTask(task, now, patch) {
	const candidate = {
		...task,
		...patch,
		revision: task.revision + 1,
		updatedAt: Math.max(now, task.updatedAt)
	};
	for (const key of [
		"workspaceId",
		"cwd",
		"agentPreset",
		"currentSessionId",
		"lastStartFailure",
		"completedAt"
	]) if (candidate[key] === void 0) Reflect.deleteProperty(candidate, key);
	return freezeTask(candidate);
}
function transitionActivity(metadata, from, to) {
	return {
		id: derivedActivityId(metadata.activityId, "transition"),
		at: metadata.now,
		actor: "system",
		operation: "transition",
		from,
		to
	};
}
function activeRound(task) {
	const round = task.rounds.at(-1);
	if (round === void 0 || round.status !== "starting" && round.status !== "running") throw stateError("round is not active");
	return round;
}
function replaceLatestRound(task, round) {
	/* v8 ignore next -- callers obtain `round` from activeRound on the same task. */
	if (task.rounds.length === 0) throw stateError("task has no execution round");
	return [...task.rounds.slice(0, -1), round];
}
function createRound(task, input) {
	return {
		id: input.roundId,
		ordinal: task.rounds.length + 1,
		trigger: input.trigger,
		status: "starting",
		originStatus: task.status,
		sessionId: input.sessionId,
		prompts: [input.prompt],
		startedAt: input.now,
		...input.feedback === void 0 ? {} : { feedback: input.feedback }
	};
}
function validateStart(task, trigger) {
	const latest = task.rounds.at(-1);
	if (latest?.status === "starting" || latest?.status === "running") throw stateError(`round already active: ${latest.id}`);
	switch (trigger) {
		case "initial":
			requireTransition(task, "initialized", "start");
			return;
		case "revision":
			requireTransition(task, "review", "reject");
			return;
		case "retry":
			requireTransition(task, "failed", "retry");
			return;
		/* v8 ignore next -- TaskBoardRoundTrigger is a closed same-process union. */
		default: assertNever(trigger, "round trigger");
	}
}
function automaticTitle(request, maxChars) {
	const source = request.description.trim() || request.acceptanceCriteria.trim();
	const firstLineEnd = source.search(/\r?\n/);
	const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd);
	return Array.from(firstLine).slice(0, maxChars).join("");
}
function positionNumber(position) {
	if (!/^\d+$/.test(position)) return void 0;
	const value = Number(position);
	return Number.isSafeInteger(value) && value > 0 ? value : void 0;
}
function formatPosition(value) {
	/* v8 ignore next -- callers pass bounded positive sums or one-based array indexes. */
	if (!Number.isSafeInteger(value) || value < 1) throw stateError("position must be a positive safe integer");
	return String(value).padStart(POSITION_WIDTH, "0");
}
function positionBetween(previous, next) {
	const previousValue = previous === void 0 ? 0 : positionNumber(previous);
	const nextValue = next === void 0 ? void 0 : positionNumber(next);
	if (previousValue === void 0 || next !== void 0 && nextValue === void 0) return void 0;
	if (nextValue === void 0) {
		if (previousValue > Number.MAX_SAFE_INTEGER - POSITION_STEP) return void 0;
		return formatPosition(previousValue + POSITION_STEP);
	}
	if (nextValue - previousValue <= 1) return void 0;
	return formatPosition(previousValue + Math.floor((nextValue - previousValue) / 2));
}
function sameAttachments(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
/**
* Create an initialized immutable record from already validated user input.
* @param request - Initial task content and placement.
* @param metadata - Host-owned identifiers, time, and title limit.
* @returns Detached immutable task at revision zero.
*/
function createTaskRecord(request, metadata) {
	if (metadata.automaticTitleMaxChars < 1) throw stateError("automatic title limit must be positive");
	if (request.workspaceId !== void 0 && request.cwd !== void 0) throw stateError("task may select a Workspace or cwd, not both");
	const manualTitle = request.title !== void 0 && request.title.trim().length > 0;
	const title = request.title !== void 0 && request.title.trim().length > 0 ? request.title : automaticTitle(request, metadata.automaticTitleMaxChars);
	return freezeTask({
		id: metadata.id,
		sequence: metadata.sequence,
		identifier: `DSH-${metadata.sequence}`,
		revision: 0,
		title,
		titleMode: manualTitle ? "manual" : "automatic",
		description: request.description,
		acceptanceCriteria: request.acceptanceCriteria,
		status: "initialized",
		position: metadata.position,
		...request.workspaceId === void 0 ? {} : { workspaceId: request.workspaceId },
		...request.cwd === void 0 ? {} : { cwd: request.cwd },
		...request.agentPreset === void 0 ? {} : { agentPreset: request.agentPreset },
		attachments: request.attachments ?? [],
		rounds: [],
		activity: [{
			id: metadata.activityId,
			at: metadata.now,
			actor: "user",
			operation: "created"
		}],
		createdAt: metadata.now,
		updatedAt: metadata.now
	});
}
/**
* Apply a material content edit outside active execution.
* @param task - Current authoritative task.
* @param patch - Fields to replace or clear.
* @param metadata - Activity identity and Host time.
* @param automaticTitleMaxChars - Title limit used when resetting automatic mode.
* @returns Original task for a no-op, otherwise a detached next revision.
*/
function editTaskRecord(task, patch, metadata, automaticTitleMaxChars) {
	if (task.status === "running") throw stateError("invalid transition: cannot edit from running");
	if (patch.resetAutomaticTitle === true && patch.title !== void 0) throw stateError("title and resetAutomaticTitle cannot be supplied together");
	if (patch.workspaceId != null && patch.cwd != null) throw stateError("task may select a Workspace or cwd, not both");
	let next = task;
	const fields = [];
	const assign = (field, value) => {
		if (next[field] === value) return;
		next = {
			...next,
			[field]: value
		};
		fields.push(field);
	};
	if (patch.title !== void 0) {
		assign("title", patch.title);
		if (next.titleMode !== "manual") next = {
			...next,
			titleMode: "manual"
		};
	}
	if (patch.resetAutomaticTitle === true) {
		assign("title", automaticTitle({
			title: "",
			description: patch.description ?? next.description,
			acceptanceCriteria: patch.acceptanceCriteria ?? next.acceptanceCriteria,
			start: false
		}, automaticTitleMaxChars));
		if (next.titleMode !== "automatic") next = {
			...next,
			titleMode: "automatic"
		};
	}
	if (patch.description !== void 0) assign("description", patch.description);
	if (patch.acceptanceCriteria !== void 0) assign("acceptanceCriteria", patch.acceptanceCriteria);
	if (patch.workspaceId !== void 0) {
		const desiredWorkspace = patch.workspaceId ?? void 0;
		if (next.workspaceId !== desiredWorkspace) {
			const { workspaceId: _workspaceId, ...withoutWorkspace } = next;
			next = desiredWorkspace === void 0 ? withoutWorkspace : {
				...withoutWorkspace,
				workspaceId: desiredWorkspace
			};
			fields.push("workspaceId");
		}
		if (desiredWorkspace !== void 0 && next.cwd !== void 0) {
			const { cwd: _cwd, ...withoutCwd } = next;
			next = withoutCwd;
			fields.push("cwd");
		}
	}
	if (patch.cwd !== void 0) {
		const desiredCwd = patch.cwd ?? void 0;
		if (next.cwd !== desiredCwd) {
			const { cwd: _cwd, ...withoutCwd } = next;
			next = desiredCwd === void 0 ? withoutCwd : {
				...withoutCwd,
				cwd: desiredCwd
			};
			fields.push("cwd");
		}
		if (desiredCwd !== void 0 && next.workspaceId !== void 0) {
			const { workspaceId: _workspaceId, ...withoutWorkspace } = next;
			next = withoutWorkspace;
			fields.push("workspaceId");
		}
	}
	if (patch.agentPreset !== void 0) {
		const desiredPreset = patch.agentPreset ?? void 0;
		if (next.agentPreset !== desiredPreset) {
			const { agentPreset: _agentPreset, ...withoutPreset } = next;
			next = desiredPreset === void 0 ? withoutPreset : {
				...withoutPreset,
				agentPreset: desiredPreset
			};
			fields.push("agentPreset");
		}
	}
	if (patch.attachments !== void 0 && !sameAttachments(next.attachments, patch.attachments)) {
		next = {
			...next,
			attachments: patch.attachments
		};
		fields.push("attachments");
	}
	const uniqueFields = [...new Set(fields)];
	if (uniqueFields.length === 0) return task;
	return nextTask(task, metadata.now, {
		...next,
		workspaceId: next.workspaceId,
		cwd: next.cwd,
		agentPreset: next.agentPreset,
		activity: [...task.activity, {
			id: metadata.activityId,
			at: metadata.now,
			actor: "user",
			operation: "edited",
			fields: uniqueFields
		}]
	});
}
/**
* Start one execution round through a legal workflow action.
* @param task - Current authoritative task.
* @param input - Round, Session, prompt, and activity allocation.
* @returns Detached running task with one new active latest round.
*/
function startRoundRecord(task, input) {
	validateStart(task, input.trigger);
	const round = createRound(task, input);
	return nextTask(task, input.now, {
		status: "running",
		currentSessionId: input.sessionId,
		rounds: [...task.rounds, round],
		activity: [
			...task.activity,
			{
				id: input.activityId,
				at: input.now,
				actor: "user",
				operation: "started",
				roundId: input.roundId,
				trigger: input.trigger
			},
			transitionActivity(input, task.status, "running")
		],
		lastStartFailure: void 0,
		completedAt: void 0
	});
}
/**
* Append a board prompt to the current active round.
* @param task - Running authoritative task.
* @param prompt - Prompt requested through the ordinary Session API.
* @param metadata - Activity identity and Host time.
* @returns Detached next revision retaining the same round.
*/
function appendPromptRecord(task, prompt, metadata) {
	requireTransition(task, "running", "follow up");
	const round = activeRound(task);
	const activity = prompt.kind === "followup" ? [{
		id: metadata.activityId,
		at: metadata.now,
		actor: "user",
		operation: "followup",
		roundId: round.id,
		promptId: prompt.id
	}] : [];
	return nextTask(task, metadata.now, {
		rounds: replaceLatestRound(task, {
			...round,
			prompts: [...round.prompts, prompt]
		}),
		activity: [...task.activity, ...activity]
	});
}
/**
* Mark a newly admitted round as running after ApiProxy accepts its prompt.
* @param task - Running task whose latest round is still starting.
* @param metadata - Host time for the durable admission update.
* @returns Original task when already running, otherwise a detached next revision.
*/
function markRoundRunningRecord(task, metadata) {
	requireTransition(task, "running", "mark round running");
	const round = activeRound(task);
	if (round.status === "running") return task;
	return nextTask(task, metadata.now, { rounds: replaceLatestRound(task, {
		...round,
		status: "running"
	}) });
}
/**
* Restore a round's origin workflow state when Session or prompt admission fails.
* @param task - Running task with the failed starting latest round.
* @param failure - Stable user-safe admission failure.
* @param metadata - Activity identity and Host time.
* @returns Detached origin-state task retaining the failed round for diagnosis.
*/
function failRoundAdmissionRecord(task, failure, metadata) {
	requireTransition(task, "running", "fail round admission");
	const round = activeRound(task);
	const previousSessionId = task.rounds.at(-2)?.sessionId;
	return nextTask(task, metadata.now, {
		status: round.originStatus,
		currentSessionId: previousSessionId,
		rounds: replaceLatestRound(task, {
			...round,
			status: "failed",
			endedAt: metadata.now,
			failure
		}),
		lastStartFailure: failure,
		activity: [
			...task.activity,
			{
				id: metadata.activityId,
				at: metadata.now,
				actor: "system",
				operation: "failed",
				roundId: round.id,
				failure
			},
			transitionActivity(metadata, "running", round.originStatus)
		]
	});
}
/**
* Attach Session sequence and turn evidence to prompts in the active round.
* @param task - Running task whose latest round owns the prompts.
* @param evidence - Matched durable Session evidence by prompt identity.
* @param now - Host reconciliation time.
* @returns Original task when unchanged, otherwise a detached next revision.
*/
function recordRoundEvidence(task, evidence, now) {
	requireTransition(task, "running", "record Session evidence");
	const round = activeRound(task);
	const byPrompt = new Map(evidence.map((item) => [item.promptId, item]));
	const prompts = round.prompts.map((prompt) => {
		const matched = byPrompt.get(prompt.id);
		if (matched === void 0) return prompt;
		if (prompt.messageSeq === matched.messageSeq && prompt.turn === matched.turn && prompt.turnEndSeq === matched.turnEndSeq) return prompt;
		return {
			...prompt,
			messageSeq: matched.messageSeq,
			turn: matched.turn,
			...matched.turnEndSeq === void 0 ? {} : { turnEndSeq: matched.turnEndSeq }
		};
	});
	if (prompts.every((prompt, index) => prompt === round.prompts[index])) return task;
	const startSeq = Math.min(...evidence.map((item) => item.turnStartSeq));
	const terminalSeqs = evidence.flatMap((item) => item.turnEndSeq === void 0 ? [] : [item.turnEndSeq]);
	return nextTask(task, now, { rounds: replaceLatestRound(task, {
		...round,
		prompts,
		startSeq,
		...terminalSeqs.length === 0 ? {} : { endSeq: Math.max(...terminalSeqs) }
	}) });
}
/**
* Remove a just-staged prompt after ApiProxy rejects it.
* @param task - Running task containing the staged prompt.
* @param promptId - Prompt that did not enter the Session.
* @param now - Host rollback time.
* @returns Detached next revision, or original task if prompt is absent.
*/
function rollbackPromptRecord(task, promptId, now) {
	requireTransition(task, "running", "rollback prompt");
	const round = activeRound(task);
	if (!round.prompts.some((prompt) => prompt.id === promptId)) return task;
	return nextTask(task, now, {
		rounds: replaceLatestRound(task, {
			...round,
			prompts: round.prompts.filter((prompt) => prompt.id !== promptId)
		}),
		activity: task.activity.filter((activity) => activity.operation !== "followup" || activity.promptId !== promptId)
	});
}
/**
* Record a user stop request while Session cancellation settles.
* @param task - Running task with an active latest round.
* @param metadata - Activity identity and Host time.
* @returns Detached running revision carrying stop intent.
*/
function requestStopRecord(task, metadata) {
	requireTransition(task, "running", "stop");
	const round = activeRound(task);
	return nextTask(task, metadata.now, { activity: [...task.activity, {
		id: metadata.activityId,
		at: metadata.now,
		actor: "user",
		operation: "stopped",
		roundId: round.id
	}] });
}
/**
* Start a revision round from human review using the current Session.
* @param task - Task awaiting review.
* @param input - Required feedback and deterministic identifiers.
* @returns Detached running task with a revision round.
*/
function rejectTaskRecord(task, input) {
	requireTransition(task, "review", "reject");
	if (input.feedback.trim().length === 0) throw stateError("rejection feedback is blank");
	if (task.currentSessionId === void 0) throw stateError("review task has no current Session");
	return startRoundRecord(freezeTask({
		...task,
		activity: [...task.activity, {
			id: input.activityId,
			at: input.now,
			actor: "user",
			operation: "rejected",
			roundId: input.roundId,
			feedback: input.feedback
		}]
	}), {
		roundId: input.roundId,
		sessionId: task.currentSessionId,
		trigger: "revision",
		feedback: input.feedback,
		prompt: {
			id: input.promptId,
			rpcId: input.rpcId,
			kind: "feedback",
			text: input.feedback,
			acceptedAt: input.now
		},
		activityId: derivedActivityId(input.activityId, "started"),
		now: input.now
	});
}
/**
* Start one explicit retry round after execution failure.
* @param task - Failed task that remains unchanged until this call.
* @param input - Chosen Session, prompt text, and deterministic identifiers.
* @returns Detached running task with exactly one new retry round.
*/
function retryTaskRecord(task, input) {
	requireTransition(task, "failed", "retry");
	return startRoundRecord(freezeTask({
		...task,
		activity: [...task.activity, {
			id: input.activityId,
			at: input.now,
			actor: "user",
			operation: "retried",
			roundId: input.roundId
		}]
	}), {
		roundId: input.roundId,
		sessionId: input.sessionId,
		trigger: "retry",
		prompt: {
			id: input.promptId,
			rpcId: input.rpcId,
			kind: "retry-continuation",
			text: input.text,
			acceptedAt: input.now
		},
		activityId: derivedActivityId(input.activityId, "started"),
		now: input.now
	});
}
/**
* Reduce ordered terminal Session evidence to one workflow outcome.
* @param signals - Terminal evidence in Session sequence order.
* @returns Running when no evidence exists, otherwise the last terminal projection.
*/
function projectRoundOutcome(signals) {
	let projection = { kind: "running" };
	for (const signal of signals) switch (signal.kind) {
		case "completed":
			projection = {
				kind: "review",
				...signal.endSeq === void 0 ? {} : { endSeq: signal.endSeq }
			};
			break;
		case "error":
			projection = {
				kind: "failed",
				failure: signal.failure,
				...signal.endSeq === void 0 ? {} : { endSeq: signal.endSeq }
			};
			break;
		case "cancelled":
			projection = {
				kind: "cancelled",
				failure: signal.failure,
				...signal.endSeq === void 0 ? {} : { endSeq: signal.endSeq }
			};
			break;
		/* v8 ignore next -- TaskBoardRoundOutcomeSignal is a closed same-process union. */
		default: assertNever(signal, "round outcome signal");
	}
	return projection;
}
/**
* Apply a Session-derived outcome to the active latest round.
* @param task - Running task with one active latest round.
* @param projection - Current projection of durable Session evidence.
* @param metadata - Activity identity and Host reconciliation time.
* @returns Original task while still running, otherwise a detached terminal revision.
*/
function reconcileRound(task, projection, metadata) {
	requireTransition(task, "running", "reconcile");
	const round = activeRound(task);
	switch (projection.kind) {
		case "running": return round.status === "running" ? task : nextTask(task, metadata.now, { rounds: replaceLatestRound(task, {
			...round,
			status: "running"
		}) });
		case "review": {
			const terminalRound = {
				...round,
				status: "completed",
				endedAt: metadata.now,
				...projection.endSeq === void 0 ? {} : { endSeq: projection.endSeq }
			};
			return nextTask(task, metadata.now, {
				status: "review",
				rounds: replaceLatestRound(task, terminalRound),
				activity: [...task.activity, transitionActivity(metadata, "running", "review")]
			});
		}
		case "failed":
		case "cancelled": {
			const terminalRound = {
				...round,
				status: projection.kind === "failed" ? "failed" : "cancelled",
				endedAt: metadata.now,
				failure: projection.failure,
				...projection.endSeq === void 0 ? {} : { endSeq: projection.endSeq }
			};
			return nextTask(task, metadata.now, {
				status: "failed",
				rounds: replaceLatestRound(task, terminalRound),
				activity: [
					...task.activity,
					{
						id: metadata.activityId,
						at: metadata.now,
						actor: "system",
						operation: "failed",
						roundId: round.id,
						failure: projection.failure
					},
					transitionActivity(metadata, "running", "failed")
				]
			});
		}
		/* v8 ignore next -- TaskBoardRoundProjection is a closed same-process union. */
		default: return assertNever(projection, "round projection");
	}
}
/**
* Record explicit human approval.
* @param task - Task awaiting review.
* @param metadata - Activity identity and Host time.
* @returns Detached completed task.
*/
function approveTaskRecord(task, metadata) {
	requireTransition(task, "review", "approve");
	return nextTask(task, metadata.now, {
		status: "done",
		completedAt: metadata.now,
		activity: [
			...task.activity,
			{
				id: metadata.activityId,
				at: metadata.now,
				actor: "user",
				operation: "approved"
			},
			transitionActivity(metadata, "review", "done")
		]
	});
}
/**
* Return an approved task to initialized state for new work.
* @param task - Completed task.
* @param metadata - Activity identity and Host time.
* @returns Detached initialized task retaining prior rounds.
*/
function reopenTaskRecord(task, metadata) {
	requireTransition(task, "done", "reopen");
	const { completedAt: _completedAt, ...withoutCompletion } = task;
	return nextTask(task, metadata.now, {
		...withoutCompletion,
		status: "initialized",
		completedAt: void 0,
		activity: [
			...task.activity,
			{
				id: metadata.activityId,
				at: metadata.now,
				actor: "user",
				operation: "reopened"
			},
			transitionActivity(metadata, "done", "initialized")
		]
	});
}
/**
* Reorder one task among same-status siblings without changing workflow state.
* @param task - Current authoritative task.
* @param siblings - Complete current column inventory.
* @param request - Optional task before which the card should be placed.
* @param metadata - Host mutation time.
* @returns Ordered immutable records and records requiring persistence.
*/
function reorderTaskRecord(task, siblings, request, metadata) {
	if (siblings.some((sibling) => sibling.status !== task.status)) throw stateError("reorder requires every sibling to have the same status");
	if (siblings.filter((sibling) => sibling.id === task.id).length !== 1) throw stateError("reorder requires the task exactly once");
	if (request.beforeTaskId === task.id) return {
		task,
		tasks: [...siblings].sort((left, right) => left.position.localeCompare(right.position)),
		changed: []
	};
	const ordered = [...siblings].sort((left, right) => left.position.localeCompare(right.position));
	const withoutTask = ordered.filter((sibling) => sibling.id !== task.id);
	const insertAt = request.beforeTaskId === void 0 ? withoutTask.length : withoutTask.findIndex((sibling) => sibling.id === request.beforeTaskId);
	if (insertAt < 0) throw stateError("reorder anchor is not in the same status");
	const previous = withoutTask[insertAt - 1];
	const next = withoutTask[insertAt];
	const directPosition = positionBetween(previous?.position, next?.position);
	if (directPosition !== void 0) {
		if (directPosition === task.position) return {
			task,
			tasks: ordered,
			changed: []
		};
		const moved = nextTask(task, metadata.now, { position: directPosition });
		const tasks = [...withoutTask];
		tasks.splice(insertAt, 0, moved);
		return {
			task: moved,
			tasks,
			changed: [moved]
		};
	}
	const rebalancedOrder = [...withoutTask];
	rebalancedOrder.splice(insertAt, 0, task);
	const changed = [];
	const tasks = rebalancedOrder.map((current, index) => {
		const position = formatPosition((index + 1) * POSITION_STEP);
		if (position === current.position) return current;
		const replacement = nextTask(current, metadata.now, { position });
		changed.push(replacement);
		return replacement;
	});
	const moved = tasks.find((current) => current.id === task.id);
	/* v8 ignore next -- the task is inserted into rebalancedOrder immediately above. */
	if (moved === void 0) throw stateError("reordered task disappeared");
	return {
		task: moved,
		tasks,
		changed
	};
}
/**
* Decide whether deletion is legal after any required confirmation.
* @param task - Current authoritative task.
* @param confirmed - Human confirmation for reviewed, completed, or failed work.
* @returns `true` only when deletion may proceed.
*/
function deleteAllowed(task, confirmed) {
	switch (task.status) {
		case "initialized": return true;
		case "review":
		case "done":
		case "failed": return confirmed;
		case "running": return false;
		/* v8 ignore next -- TaskBoardStatus is a closed same-process union. */
		default: return assertNever(task.status, "task status");
	}
}
/**
* Create a detached deeply frozen task projection.
* @param task - Internal authoritative task record.
* @returns Immutable snapshot sharing no mutable child with the source.
*/
function snapshotTask(task) {
	return freezeTask(task);
}
/**
* Create an authoritative sorted board projection.
* @param tasks - Internal task records in arbitrary order.
* @param boardRevision - Committed global board revision.
* @returns Deeply immutable snapshot sorted by status and position.
*/
function snapshotBoard(tasks, boardRevision) {
	return freezeSnapshot({
		boardRevision,
		tasks: tasks.map(snapshotTask).sort((left, right) => {
			const statusDifference = STATUS_RANK[left.status] - STATUS_RANK[right.status];
			if (statusDifference !== 0) return statusDifference;
			const positionDifference = left.position.localeCompare(right.position);
			return positionDifference !== 0 ? positionDifference : left.sequence - right.sequence;
		})
	});
}
/**
* Build the ordinary initial Session prompt from task content.
* @param task - Task whose requirement should enter model history.
* @returns Prompt text with acceptance criteria only when supplied.
*/
function composeInitialPrompt(task) {
	const description = task.description.trim();
	const criteria = task.acceptanceCriteria.trim();
	if (criteria.length === 0) return description;
	if (description.length === 0) return `Acceptance criteria:\n${criteria}`;
	return `${description}\n\nAcceptance criteria:\n${criteria}`;
}
//#endregion
//#region lib/types/host/service.js
/** Durable reviewed task cards and Harness Session orchestration service. @module @deepseek-ai/dsh-task-board */
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
function success(value) {
	return {
		ok: true,
		value
	};
}
function decodeAttachmentData(data) {
	if (data.length === 0) return void 0;
	const decoded = Buffer.from(data, "base64");
	return decoded.toString("base64") === data ? new Uint8Array(decoded) : void 0;
}
function rejected(error) {
	return {
		ok: false,
		error
	};
}
function positiveSafeInteger(name, value) {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`task-board: ${name} must be a positive safe integer, got ${String(value)}`);
	return value;
}
function taskId() {
	return randomUUID();
}
function activityId() {
	return randomUUID();
}
function roundId() {
	return randomUUID();
}
function promptId() {
	return randomUUID();
}
function sessionId() {
	return SessionId(`task-board-${randomUUID()}`);
}
function rpcId() {
	return TaskBoardSessionRequestId(randomUUID());
}
function initialPosition(sequence) {
	const value = sequence * 1e6;
	if (!Number.isSafeInteger(value)) throw new Error("task-board: sequence exceeds ordering range");
	return String(value).padStart(16, "0");
}
/** Host authority for durable task cards and public `taskBoard` Remote methods. */
let TaskBoardService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _snapshot_decorators;
	let _uploadAttachment_decorators;
	let _create_decorators;
	let _edit_decorators;
	let _reorder_decorators;
	let _start_decorators;
	let _followup_decorators;
	let _reject_decorators;
	let _retry_decorators;
	let _stop_decorators;
	let _approve_decorators;
	let _reopen_decorators;
	let _delete_decorators;
	return class TaskBoardService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_snapshot_decorators = [Remote("snapshot")];
			_uploadAttachment_decorators = [Remote("uploadAttachment")];
			_create_decorators = [Remote("create")];
			_edit_decorators = [Remote("edit")];
			_reorder_decorators = [Remote("reorder")];
			_start_decorators = [Remote("start")];
			_followup_decorators = [Remote("followup")];
			_reject_decorators = [Remote("reject")];
			_retry_decorators = [Remote("retry")];
			_stop_decorators = [Remote("stop")];
			_approve_decorators = [Remote("approve")];
			_reopen_decorators = [Remote("reopen")];
			_delete_decorators = [Remote("delete")];
			__esDecorate(this, null, _snapshot_decorators, {
				kind: "method",
				name: "snapshot",
				static: false,
				private: false,
				access: {
					has: (obj) => "snapshot" in obj,
					get: (obj) => obj.snapshot
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _uploadAttachment_decorators, {
				kind: "method",
				name: "uploadAttachment",
				static: false,
				private: false,
				access: {
					has: (obj) => "uploadAttachment" in obj,
					get: (obj) => obj.uploadAttachment
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _create_decorators, {
				kind: "method",
				name: "create",
				static: false,
				private: false,
				access: {
					has: (obj) => "create" in obj,
					get: (obj) => obj.create
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _edit_decorators, {
				kind: "method",
				name: "edit",
				static: false,
				private: false,
				access: {
					has: (obj) => "edit" in obj,
					get: (obj) => obj.edit
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _reorder_decorators, {
				kind: "method",
				name: "reorder",
				static: false,
				private: false,
				access: {
					has: (obj) => "reorder" in obj,
					get: (obj) => obj.reorder
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _start_decorators, {
				kind: "method",
				name: "start",
				static: false,
				private: false,
				access: {
					has: (obj) => "start" in obj,
					get: (obj) => obj.start
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _followup_decorators, {
				kind: "method",
				name: "followup",
				static: false,
				private: false,
				access: {
					has: (obj) => "followup" in obj,
					get: (obj) => obj.followup
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _reject_decorators, {
				kind: "method",
				name: "reject",
				static: false,
				private: false,
				access: {
					has: (obj) => "reject" in obj,
					get: (obj) => obj.reject
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _retry_decorators, {
				kind: "method",
				name: "retry",
				static: false,
				private: false,
				access: {
					has: (obj) => "retry" in obj,
					get: (obj) => obj.retry
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _stop_decorators, {
				kind: "method",
				name: "stop",
				static: false,
				private: false,
				access: {
					has: (obj) => "stop" in obj,
					get: (obj) => obj.stop
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _approve_decorators, {
				kind: "method",
				name: "approve",
				static: false,
				private: false,
				access: {
					has: (obj) => "approve" in obj,
					get: (obj) => obj.approve
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _reopen_decorators, {
				kind: "method",
				name: "reopen",
				static: false,
				private: false,
				access: {
					has: (obj) => "reopen" in obj,
					get: (obj) => obj.reopen
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _delete_decorators, {
				kind: "method",
				name: "delete",
				static: false,
				private: false,
				access: {
					has: (obj) => "delete" in obj,
					get: (obj) => obj.delete
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = [
			"agents",
			"attachments",
			"sessionPersistence",
			"sessions",
			"storageDomain",
			"taskBoardSession"
		];
		/** Loader validation for every deployment-varying text limit. */
		static Config = s.object({
			automaticTitleMaxChars: s.number().step(1).min(1).required(),
			maxTitleBytes: s.number().step(1).min(1).required(),
			maxDescriptionBytes: s.number().step(1).min(1).required(),
			maxAcceptanceCriteriaBytes: s.number().step(1).min(1).required(),
			maxFeedbackBytes: s.number().step(1).min(1).required(),
			maxFollowupBytes: s.number().step(1).min(1).required()
		});
		config = __runInitializers(this, _instanceExtraInitializers);
		global;
		tasks;
		boardTail = Promise.resolve();
		taskTails = /* @__PURE__ */ new Map();
		activeSessions = /* @__PURE__ */ new Map();
		mutationAdmissionOpen = true;
		/**
		* @param ctx - Host context carrying the Storage Domain facility.
		* @param config - Required text and automatic-title limits.
		*/
		constructor(ctx, config) {
			super(ctx, "taskBoard");
			this.config = {
				automaticTitleMaxChars: positiveSafeInteger("automaticTitleMaxChars", config.automaticTitleMaxChars),
				maxTitleBytes: positiveSafeInteger("maxTitleBytes", config.maxTitleBytes),
				maxDescriptionBytes: positiveSafeInteger("maxDescriptionBytes", config.maxDescriptionBytes),
				maxAcceptanceCriteriaBytes: positiveSafeInteger("maxAcceptanceCriteriaBytes", config.maxAcceptanceCriteriaBytes),
				maxFeedbackBytes: positiveSafeInteger("maxFeedbackBytes", config.maxFeedbackBytes),
				maxFollowupBytes: positiveSafeInteger("maxFollowupBytes", config.maxFollowupBytes)
			};
		}
		/** Open and own the task-board Storage Domain. */
		async [Service.init]() {
			const domain = await this.ctx.storageDomain.open(taskBoardDomainSpec);
			this.global = domain.global;
			this.tasks = domain.table("tasks");
			this.rebuildActiveSessions();
			this.ctx.on("session/event", (session) => {
				this.scheduleReconcile(session.id);
			}, { global: true });
			this.ctx.on("agent/status", ({ agent, status }) => {
				if (status === "idle") this.scheduleReconcile(agent.id);
			}, { global: true });
			this.ctx.effect(() => async () => {
				this.mutationAdmissionOpen = false;
				await Promise.all([...this.taskTails.values(), this.boardTail]);
				await domain.close();
			}, "task-board.domainClose");
			for (const activeSessionId of this.activeSessions.keys()) this.scheduleReconcile(activeSessionId);
		}
		/**
		* Read the authoritative board after all previously admitted commits.
		* @returns Immutable board snapshot and committed global revision.
		*/
		snapshot() {
			return this.enqueueBoard(() => Promise.resolve(success(snapshotBoard([...this.requireTasks().entries()].map(([, task]) => task), this.requireGlobal().get().boardRevision))));
		}
		/**
		* Validate and persist one browser-staged task image.
		* @param request - Canonical base64 bytes, declared media type, and optional display name.
		* @returns Durable image reference or a correction-oriented request failure.
		*/
		async uploadAttachment(request) {
			const data = decodeAttachmentData(request.data);
			if (data === void 0) return this.invalidRequest("attachment", "Image upload must use canonical base64.");
			try {
				return success(await this.ctx.attachments.saveImage({
					data,
					mediaType: request.mediaType,
					...request.name === void 0 ? {} : { name: request.name }
				}));
			} catch (error) {
				return rejected({
					code: "attachment-error",
					reason: error instanceof AttachmentError ? error.code : "ATTACHMENT_STORE_FAILED",
					message: error instanceof AttachmentError ? error.message : "Image upload could not be stored."
				});
			}
		}
		/**
		* Create one durable initialized card and optionally start it.
		* @param request - Validated task content, placement, and start intent.
		* @returns Committed card or a stable request failure.
		*/
		async create(request) {
			const valid = this.validateCreate(request);
			if (!valid.ok) return valid;
			const created = await this.enqueueBoard(async () => {
				const currentGlobal = this.requireGlobal().get();
				const task = createTaskRecord(request, {
					id: taskId(),
					sequence: currentGlobal.nextSequence,
					position: initialPosition(currentGlobal.nextSequence),
					activityId: activityId(),
					now: Date.now(),
					automaticTitleMaxChars: this.config.automaticTitleMaxChars
				});
				const boardRevision = currentGlobal.boardRevision + 1;
				await this.requireGlobal().set({
					nextSequence: currentGlobal.nextSequence + 1,
					boardRevision
				});
				await this.requireTasks().put(task.id, task);
				this.refreshActiveSession(task);
				this.emitChange({
					boardRevision,
					operation: "created",
					taskId: task.id,
					task
				});
				return success(snapshotTask(task));
			});
			if (!request.start) return created;
			return this.start({
				id: created.value.id,
				revision: created.value.revision
			});
		}
		/**
		* Replace material card fields after a compare-and-set revision check.
		* @param ref - Task identity and observed revision.
		* @param patch - Fields to replace, clear, or reset to automatic title.
		* @returns Committed card, current conflict value, or stable request failure.
		*/
		edit(ref, patch) {
			const validPatch = this.validateEditPatch(patch);
			if (!validPatch.ok) return Promise.resolve(validPatch);
			return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
				const current = this.resolveRef(ref);
				if (!current.ok) return current;
				const description = patch.description ?? current.value.description;
				const criteria = patch.acceptanceCriteria ?? current.value.acceptanceCriteria;
				if (description.trim().length === 0 && criteria.trim().length === 0) return this.invalidRequest("description", "description and acceptanceCriteria cannot both be blank");
				let next;
				try {
					next = editTaskRecord(current.value, patch, {
						activityId: activityId(),
						now: Date.now()
					}, this.config.automaticTitleMaxChars);
				} catch (error) {
					if (!(error instanceof TaskBoardStateError)) throw error;
					return this.invalidRequest("patch", error.message);
				}
				if (next === current.value) return success(snapshotTask(current.value));
				return success(await this.commitTask(next, "updated"));
			}, true));
		}
		/**
		* Move a card before another card in the same workflow state.
		* @param ref - Task identity and observed revision.
		* @param request - Optional same-column anchor; omission appends.
		* @returns Committed moved task or stable rejection.
		*/
		reorder(ref, request) {
			return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
				const current = this.resolveRef(ref);
				if (!current.ok) return current;
				const siblings = [...this.requireTasks().entries()].map(([, task]) => task).filter((task) => task.status === current.value.status);
				let result;
				try {
					result = reorderTaskRecord(current.value, siblings, request, { now: Date.now() });
				} catch (error) {
					if (!(error instanceof TaskBoardStateError)) throw error;
					return this.invalidRequest("beforeTaskId", error.message);
				}
				for (const changed of result.changed) await this.commitTask(changed, "updated");
				const committed = this.requireTasks().get(ref.id);
				if (committed === void 0) throw new Error(`task-board: reordered task '${ref.id}' disappeared`);
				return success(snapshotTask(committed));
			}, true));
		}
		/**
		* Start an initialized card in a newly created Harness Session.
		* @param ref - Task identity and observed revision.
		* @returns Running task after prompt admission, or a stable rejection.
		*/
		start(ref) {
			return this.enqueueTask(ref.id, async () => {
				const current = this.resolveRef(ref);
				if (!current.ok) return current;
				const nextSessionId = sessionId();
				const nextPromptId = promptId();
				const nextPromptRpcId = rpcId();
				let starting;
				try {
					starting = startRoundRecord(current.value, {
						roundId: roundId(),
						sessionId: nextSessionId,
						trigger: "initial",
						prompt: {
							id: nextPromptId,
							rpcId: nextPromptRpcId,
							kind: "initial",
							text: composeInitialPrompt(current.value),
							acceptedAt: Date.now()
						},
						activityId: activityId(),
						now: Date.now()
					});
				} catch (error) {
					return this.stateRejection(current.value, "start", error);
				}
				await this.persistUpdatedTask(starting);
				return this.admitPreparedRound(starting.id, {
					createSession: true,
					promptRpcId: nextPromptRpcId,
					promptText: composeInitialPrompt(starting),
					includeInitialAttachments: true
				});
			});
		}
		/**
		* Append a non-blank instruction to the current active round.
		* @param ref - Task identity and observed revision.
		* @param request - Follow-up text admitted through the ordinary Session API.
		* @returns Updated running task or prompt rejection.
		*/
		followup(ref, request) {
			const text = this.resolveText("text", request.text, this.config.maxFollowupBytes, false);
			if (!text.ok) return Promise.resolve(text);
			return this.enqueueTask(ref.id, async () => {
				const current = this.resolveSessionRef(ref, "followup");
				if (!current.ok) return current;
				const { sessionId: currentSessionId, task } = current.value;
				const nextPromptId = promptId();
				const nextRpcId = rpcId();
				let staged;
				try {
					staged = appendPromptRecord(task, {
						id: nextPromptId,
						rpcId: nextRpcId,
						kind: "followup",
						text: text.value,
						acceptedAt: Date.now()
					}, {
						activityId: activityId(),
						now: Date.now()
					});
				} catch (error) {
					return this.stateRejection(task, "followup", error);
				}
				await this.persistUpdatedTask(staged);
				let failure;
				try {
					const response = await this.ctx.taskBoardSession.prompt({
						requestId: nextRpcId,
						sessionId: currentSessionId,
						content: [{
							type: "text",
							text: text.value
						}]
					});
					if (!response.ok) failure = this.rpcFailure("prompt-admission", response.error);
				} catch {
					failure = {
						stage: "prompt-admission",
						code: "PROMPT_ADMISSION_FAILED",
						message: "The follow-up prompt could not be admitted."
					};
				}
				if (failure !== void 0) {
					const latest = this.requireTask(staged.id);
					await this.persistUpdatedTask(rollbackPromptRecord(latest, nextPromptId, Date.now()));
					return rejected({
						code: "prompt-rejected",
						failure
					});
				}
				return success(this.getRequiredTask(staged.id));
			});
		}
		/**
		* Reject reviewed output with required feedback and continue the same Session.
		* @param ref - Reviewed task identity and observed revision.
		* @param request - Required human feedback sent to the Agent.
		* @returns Running revision round or stable rejection.
		*/
		reject(ref, request) {
			const feedback = this.resolveText("feedback", request.feedback, this.config.maxFeedbackBytes, false);
			if (!feedback.ok) return Promise.resolve(feedback);
			return this.enqueueTask(ref.id, async () => {
				const current = this.resolveSessionRef(ref, "reject");
				if (!current.ok) return current;
				const { task } = current.value;
				const nextRpcId = rpcId();
				let starting;
				try {
					starting = rejectTaskRecord(task, {
						feedback: feedback.value,
						roundId: roundId(),
						promptId: promptId(),
						rpcId: nextRpcId,
						activityId: activityId(),
						now: Date.now()
					});
				} catch (error) {
					return this.stateRejection(task, "reject", error);
				}
				await this.persistUpdatedTask(starting);
				return this.admitPreparedRound(starting.id, {
					createSession: false,
					promptRpcId: nextRpcId,
					promptText: feedback.value,
					includeInitialAttachments: false
				});
			});
		}
		/**
		* Start exactly one user-requested retry round.
		* @param ref - Failed task identity and observed revision.
		* @param request - Permission to replace an unavailable Session.
		* @returns Running retry, `fresh-session-required`, or stable rejection.
		*/
		retry(ref, request) {
			return this.enqueueTask(ref.id, async () => {
				const current = this.resolveRef(ref);
				if (!current.ok) return current;
				if (current.value.status !== "failed") return rejected({
					code: "invalid-transition",
					status: current.value.status,
					operation: "retry"
				});
				const previousSessionId = current.value.currentSessionId;
				const resumableSessionId = previousSessionId === void 0 || this.ctx.agents.get(previousSessionId) === void 0 ? void 0 : previousSessionId;
				if (resumableSessionId === void 0 && previousSessionId !== void 0 && !request.allowFreshSession) return rejected({
					code: "fresh-session-required",
					sessionId: previousSessionId
				});
				const retrySessionId = resumableSessionId ?? sessionId();
				const createSession = resumableSessionId === void 0;
				const nextRpcId = rpcId();
				const text = `Retry the task after the previous execution failed.\n\n${composeInitialPrompt(current.value)}`;
				let starting;
				try {
					starting = retryTaskRecord(current.value, {
						sessionId: retrySessionId,
						roundId: roundId(),
						promptId: promptId(),
						rpcId: nextRpcId,
						text,
						activityId: activityId(),
						now: Date.now()
					});
				} catch (error) {
					return this.stateRejection(current.value, "retry", error);
				}
				await this.persistUpdatedTask(starting);
				return this.admitPreparedRound(starting.id, {
					createSession,
					promptRpcId: nextRpcId,
					promptText: text,
					includeInitialAttachments: false
				});
			});
		}
		/**
		* Cancel an active Session turn and wait for its durable terminal evidence.
		* @param ref - Running task identity and observed revision.
		* @returns Reconciled failed card or stable cancellation rejection.
		*/
		stop(ref) {
			return this.enqueueTask(ref.id, async () => {
				const current = this.resolveSessionRef(ref, "stop");
				if (!current.ok) return current;
				const { sessionId: currentSessionId, task } = current.value;
				let stopping;
				try {
					stopping = requestStopRecord(task, {
						activityId: activityId(),
						now: Date.now()
					});
				} catch (error) {
					return this.stateRejection(task, "stop", error);
				}
				await this.persistUpdatedTask(stopping);
				let response;
				try {
					response = await this.ctx.taskBoardSession.cancel({
						requestId: rpcId(),
						sessionId: currentSessionId
					});
				} catch {
					return rejected({
						code: "session-unavailable",
						sessionId: currentSessionId
					});
				}
				if (!response.ok) return rejected({
					code: "session-unavailable",
					sessionId: currentSessionId
				});
				await this.ctx.agents.get(currentSessionId)?.whenIdle();
				await this.reconcileTaskNow(stopping.id);
				return success(this.getRequiredTask(stopping.id));
			});
		}
		/**
		* Mark a successfully executed reviewed task complete.
		* @param ref - Task identity and observed revision.
		* @returns Committed completed card or stable transition failure.
		*/
		approve(ref) {
			return this.mutateOne(ref, "approve", (task) => approveTaskRecord(task, {
				activityId: activityId(),
				now: Date.now()
			}));
		}
		/**
		* Reopen an approved card as initialized work while retaining its history.
		* @param ref - Task identity and observed revision.
		* @returns Committed initialized card or stable transition failure.
		*/
		reopen(ref) {
			return this.mutateOne(ref, "reopen", (task) => reopenTaskRecord(task, {
				activityId: activityId(),
				now: Date.now()
			}));
		}
		/**
		* Delete a non-running card without deleting linked Sessions or attachments.
		* @param ref - Task identity and observed revision after any Client confirmation.
		* @returns Durable deletion acknowledgement or stable rejection.
		*/
		delete(ref) {
			return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
				const current = this.resolveRef(ref);
				if (!current.ok) return current;
				if (!deleteAllowed(current.value, true)) return rejected({
					code: "invalid-transition",
					status: current.value.status,
					operation: "delete"
				});
				const global = this.requireGlobal().get();
				const boardRevision = global.boardRevision + 1;
				await this.requireGlobal().set({
					...global,
					boardRevision
				});
				if (!await this.requireTasks().delete(ref.id)) throw new Error(`task-board: committed task '${ref.id}' disappeared before deletion`);
				this.emitChange({
					boardRevision,
					operation: "deleted",
					taskId: ref.id
				});
				this.removeActiveSession(ref.id);
				return success({
					deleted: true,
					taskId: ref.id
				});
			}, true));
		}
		/**
		* Read one task synchronously from committed domain memory.
		* @param id - Stable task identity.
		* @returns Detached immutable task, or `undefined` when absent.
		*/
		getTask(id) {
			const task = this.requireTasks().get(id);
			return task === void 0 ? void 0 : snapshotTask(task);
		}
		/**
		* Read every committed task for package-owned invariant checks.
		* @returns Detached immutable tasks in storage iteration order.
		*/
		inspectTasks() {
			return [...this.requireTasks().entries()].map(([, task]) => snapshotTask(task));
		}
		/**
		* Read the global revision used to validate emitted board changes.
		* @returns Current committed global board revision.
		*/
		currentBoardRevision() {
			return this.requireGlobal().get().boardRevision;
		}
		/**
		* Wait until operations already admitted for one task and the board have settled.
		* @param id - Task whose operation tail should be observed.
		* @returns Resolution after current tails settle; later operations are not included.
		*/
		async whenSettled(id) {
			await Promise.all([this.taskTails.get(id) ?? Promise.resolve(), this.boardTail]);
		}
		validateCreate(request) {
			if (request.workspaceId !== void 0 && request.cwd !== void 0) return this.invalidRequest("cwd", "workspaceId and cwd cannot both be supplied");
			const title = this.resolveText("title", request.title ?? "", this.config.maxTitleBytes, true);
			if (!title.ok) return title;
			const description = this.resolveText("description", request.description, this.config.maxDescriptionBytes, true);
			if (!description.ok) return description;
			const criteria = this.resolveText("acceptanceCriteria", request.acceptanceCriteria, this.config.maxAcceptanceCriteriaBytes, true);
			if (!criteria.ok) return criteria;
			if (description.value.trim().length === 0 && criteria.value.trim().length === 0) return this.invalidRequest("description", "description and acceptanceCriteria cannot both be blank");
			return {
				ok: true,
				value: ""
			};
		}
		validateEditPatch(patch) {
			if (patch.workspaceId != null && patch.cwd != null) return this.invalidRequest("cwd", "workspaceId and cwd cannot both be supplied");
			const fields = [
				[
					"title",
					patch.title,
					this.config.maxTitleBytes
				],
				[
					"description",
					patch.description,
					this.config.maxDescriptionBytes
				],
				[
					"acceptanceCriteria",
					patch.acceptanceCriteria,
					this.config.maxAcceptanceCriteriaBytes
				]
			];
			for (const [field, value, maxBytes] of fields) {
				if (value === void 0) continue;
				const resolution = this.resolveText(field, value, maxBytes, true);
				if (!resolution.ok) return resolution;
			}
			return {
				ok: true,
				value: ""
			};
		}
		resolveText(field, value, maxBytes, allowBlank) {
			if (!allowBlank && value.trim().length === 0) return this.invalidRequest(field, `${field} cannot be blank`);
			if (Buffer.byteLength(value, "utf8") > maxBytes) return this.invalidRequest(field, `${field} exceeds ${maxBytes} UTF-8 bytes`);
			return {
				ok: true,
				value
			};
		}
		invalidRequest(field, message) {
			return rejected({
				code: "invalid-request",
				field,
				message
			});
		}
		resolveRef(ref) {
			const current = this.requireTasks().get(ref.id);
			if (current === void 0) return rejected({
				code: "task-not-found",
				taskId: ref.id
			});
			if (current.revision !== ref.revision) return rejected({
				code: "revision-conflict",
				current: snapshotTask(current)
			});
			return success(current);
		}
		resolveSessionRef(ref, operation) {
			const current = this.resolveRef(ref);
			if (!current.ok) return current;
			const currentSessionId = current.value.currentSessionId;
			if (currentSessionId === void 0) return rejected({
				code: "invalid-transition",
				status: current.value.status,
				operation
			});
			return success({
				sessionId: currentSessionId,
				task: current.value
			});
		}
		mutateOne(ref, operation, mutate) {
			return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
				const current = this.resolveRef(ref);
				if (!current.ok) return current;
				let next;
				try {
					next = mutate(current.value);
				} catch (error) {
					if (!(error instanceof TaskBoardStateError)) throw error;
					return rejected({
						code: "invalid-transition",
						status: current.value.status,
						operation
					});
				}
				return success(await this.commitTask(next, "updated"));
			}, true));
		}
		async commitTask(task, operation) {
			const global = this.requireGlobal().get();
			const boardRevision = global.boardRevision + 1;
			await this.requireGlobal().set({
				...global,
				boardRevision
			});
			await this.requireTasks().put(task.id, task);
			this.refreshActiveSession(task);
			this.emitChange({
				boardRevision,
				operation,
				taskId: task.id,
				task
			});
			return snapshotTask(task);
		}
		emitChange(change) {
			try {
				this.ctx.emit("task-board/changed", change);
			} catch (error) {
				this.ctx.logger.warn(`task-board: task-board/changed listener failed: ${String(error)}`);
			}
		}
		async persistUpdatedTask(task) {
			return this.enqueueBoard(() => this.commitTask(task, "updated"), true);
		}
		async admitPreparedRound(id, options) {
			let task = this.requireTask(id);
			const currentSessionId = task.currentSessionId;
			if (currentSessionId === void 0) throw new Error(`task-board: starting task '${id}' has no current Session`);
			if (options.createSession) {
				let response;
				try {
					response = await this.ctx.taskBoardSession.create({
						requestId: rpcId(),
						sessionId: currentSessionId,
						...task.workspaceId === void 0 ? {} : { workspaceId: task.workspaceId },
						...task.cwd === void 0 ? {} : { cwd: task.cwd },
						...task.agentPreset === void 0 ? {} : { agentPreset: task.agentPreset }
					});
				} catch {
					return this.failAdmission(id, {
						stage: "session-create",
						code: "SESSION_CREATE_FAILED",
						message: "The Session could not be created."
					});
				}
				if (!response.ok) return this.failAdmission(id, this.rpcFailure("session-create", response.error));
			}
			const content = [{
				type: "text",
				text: options.promptText
			}];
			if (options.includeInitialAttachments) try {
				for (const attachment of task.attachments) {
					const stored = await this.ctx.attachments.readImage(attachment);
					content.push({
						type: "image",
						mediaType: stored.ref.mediaType,
						data: Buffer.from(stored.data).toString("base64"),
						...stored.ref.name === void 0 ? {} : { name: stored.ref.name }
					});
				}
			} catch {
				return this.failAdmission(id, {
					stage: "prompt-admission",
					code: "ATTACHMENT_READ_FAILED",
					message: "One or more task attachments could not be read."
				});
			}
			let promptResponse;
			try {
				promptResponse = await this.ctx.taskBoardSession.prompt({
					requestId: options.promptRpcId,
					sessionId: currentSessionId,
					content
				});
			} catch {
				return this.failAdmission(id, {
					stage: "prompt-admission",
					code: "PROMPT_ADMISSION_FAILED",
					message: "The task prompt could not be admitted."
				});
			}
			if (!promptResponse.ok) return this.failAdmission(id, this.rpcFailure("prompt-admission", promptResponse.error));
			task = this.requireTask(id);
			const running = markRoundRunningRecord(task, { now: Date.now() });
			if (running !== task) await this.persistUpdatedTask(running);
			return success(this.getRequiredTask(id));
		}
		async failAdmission(id, failure) {
			const failed = failRoundAdmissionRecord(this.requireTask(id), failure, {
				activityId: activityId(),
				now: Date.now()
			});
			await this.persistUpdatedTask(failed);
			return rejected({
				code: "prompt-rejected",
				failure
			});
		}
		rpcFailure(stage, error) {
			return {
				stage,
				code: error.code,
				message: error.message
			};
		}
		stateRejection(task, operation, error) {
			if (!(error instanceof TaskBoardStateError)) throw error;
			return rejected({
				code: "invalid-transition",
				status: task.status,
				operation
			});
		}
		scheduleReconcile(currentSessionId) {
			const id = this.activeSessions.get(currentSessionId);
			if (id === void 0 || !this.mutationAdmissionOpen) return;
			this.enqueueTask(id, () => this.reconcileTaskNow(id)).catch((error) => {
				this.ctx.logger.warn(`task-board: Session reconciliation failed: ${String(error)}`);
			});
		}
		async reconcileTaskNow(id) {
			let task = this.requireTasks().get(id);
			if (task === void 0 || task.status !== "running" || task.currentSessionId === void 0) return;
			let events;
			try {
				events = this.ctx.sessions.get(task.currentSessionId)?.events ?? (await this.ctx.sessionPersistence.inspect(task.currentSessionId)).events;
			} catch {
				const failed = reconcileRound(task, {
					kind: "failed",
					failure: {
						stage: "recovery",
						code: "SESSION_HISTORY_UNAVAILABLE",
						message: "The Session history could not be inspected."
					}
				}, {
					activityId: activityId(),
					now: Date.now()
				});
				await this.persistUpdatedTask(failed);
				return;
			}
			const projection = this.projectSessionEvidence(task, task.currentSessionId, events);
			const withEvidence = recordRoundEvidence(task, projection.evidence, Date.now());
			if (withEvidence !== task) {
				await this.persistUpdatedTask(withEvidence);
				task = withEvidence;
			}
			if (projection.outcome.kind === "running") return;
			const terminal = reconcileRound(task, projection.outcome, {
				activityId: activityId(),
				now: Date.now()
			});
			await this.persistUpdatedTask(terminal);
		}
		projectSessionEvidence(task, currentSessionId, events) {
			const round = task.rounds.at(-1);
			if (round === void 0) return {
				evidence: [],
				outcome: { kind: "running" }
			};
			const promptsByRpcId = new Map(round.prompts.map((prompt) => [prompt.rpcId, prompt]));
			const matched = /* @__PURE__ */ new Map();
			const endings = /* @__PURE__ */ new Map();
			let activeTurn;
			for (const event of events) switch (event.type) {
				case "turn/start":
					activeTurn = {
						turn: event.data.turn,
						seq: event.seq
					};
					break;
				case "user/message": {
					const source = event.data.source;
					if (activeTurn === void 0 || source.kind !== "user" || !("rpcId" in source) || typeof source.rpcId !== "string") break;
					const prompt = promptsByRpcId.get(TaskBoardSessionRequestId(source.rpcId));
					if (prompt !== void 0) matched.set(prompt.id, {
						promptId: prompt.id,
						messageSeq: event.seq,
						turn: activeTurn.turn,
						turnStartSeq: activeTurn.seq
					});
					break;
				}
				case "turn/end":
					endings.set(event.data.turn, event);
					if (activeTurn?.turn === event.data.turn) activeTurn = void 0;
			}
			const evidence = round.prompts.flatMap((prompt) => {
				const item = matched.get(prompt.id);
				if (item === void 0) return [];
				const ending = endings.get(item.turn);
				return [{
					...item,
					...ending === void 0 ? {} : { turnEndSeq: ending.seq }
				}];
			});
			const latestPrompt = round.prompts.at(-1);
			const latestEvidence = latestPrompt === void 0 ? void 0 : matched.get(latestPrompt.id);
			const ending = latestEvidence === void 0 ? void 0 : endings.get(latestEvidence.turn);
			const agent = this.ctx.agents.get(currentSessionId);
			if (evidence.length !== round.prompts.length || ending === void 0 || agent !== void 0 && agent.status !== "idle") return {
				evidence,
				outcome: { kind: "running" }
			};
			return {
				evidence,
				outcome: this.projectTurnEnd(ending.data.reason, ending.seq)
			};
		}
		projectTurnEnd(reason, endSeq) {
			switch (reason.kind) {
				case "completed": return projectRoundOutcome([{
					kind: "completed",
					endSeq
				}]);
				case "error": return projectRoundOutcome([{
					kind: "error",
					endSeq,
					failure: {
						stage: "execution",
						code: reason.error.code,
						message: "Execution failed. Open the Session log for details.",
						seq: endSeq
					}
				}]);
				case "aborted": return projectRoundOutcome([{
					kind: "cancelled",
					endSeq,
					failure: {
						stage: "execution",
						code: "CANCELLED",
						message: "Execution was stopped.",
						seq: endSeq
					}
				}]);
				case "blocked": return projectRoundOutcome([{
					kind: "error",
					endSeq,
					failure: {
						stage: "execution",
						code: "BLOCKED",
						message: "Execution was blocked.",
						seq: endSeq
					}
				}]);
				case "max-tokens": return projectRoundOutcome([{
					kind: "error",
					endSeq,
					failure: {
						stage: "execution",
						code: "MAX_TOKENS",
						message: "Execution reached the output token limit.",
						seq: endSeq
					}
				}]);
				case "interrupted": return projectRoundOutcome([{
					kind: "error",
					endSeq,
					failure: {
						stage: "recovery",
						code: "INTERRUPTED",
						message: "Execution was interrupted before shutdown completed.",
						seq: endSeq
					}
				}]);
				default: return projectRoundOutcome([{
					kind: "error",
					endSeq,
					failure: {
						stage: "execution",
						code: "UNKNOWN_TURN_END",
						message: "Execution ended with an unsupported result.",
						seq: endSeq
					}
				}]);
			}
		}
		rebuildActiveSessions() {
			this.activeSessions.clear();
			for (const [, task] of this.requireTasks().entries()) this.refreshActiveSession(task);
		}
		refreshActiveSession(task) {
			this.removeActiveSession(task.id);
			if (task.status === "running" && task.currentSessionId !== void 0) this.activeSessions.set(task.currentSessionId, task.id);
		}
		removeActiveSession(id) {
			for (const [currentSessionId, task] of this.activeSessions) if (task === id) this.activeSessions.delete(currentSessionId);
		}
		requireTask(id) {
			const task = this.requireTasks().get(id);
			if (task === void 0) throw new Error(`task-board: task '${id}' disappeared`);
			return task;
		}
		getRequiredTask(id) {
			return snapshotTask(this.requireTask(id));
		}
		enqueueTask(id, operation) {
			if (!this.mutationAdmissionOpen) return Promise.reject(/* @__PURE__ */ new Error("task-board: service is disposing"));
			const result = (this.taskTails.get(id) ?? Promise.resolve()).then(operation);
			const settled = result.then(() => {}, () => {});
			this.taskTails.set(id, settled);
			settled.then(() => {
				if (this.taskTails.get(id) === settled) this.taskTails.delete(id);
			});
			return result;
		}
		enqueueBoard(operation, alreadyAdmitted = false) {
			if (!alreadyAdmitted && !this.mutationAdmissionOpen) return Promise.reject(/* @__PURE__ */ new Error("task-board: service is disposing"));
			const result = this.boardTail.then(operation);
			this.boardTail = result.then(() => {}, () => {});
			return result;
		}
		requireGlobal() {
			if (this.global === void 0) throw new Error("task-board: service is not initialized");
			return this.global;
		}
		requireTasks() {
			if (this.tasks === void 0) throw new Error("task-board: service is not initialized");
			return this.tasks;
		}
	};
})();
//#endregion
//#region lib/types/index.js
/** Loader schema shared with the Task Board service. */
const Config = TaskBoardService.Config;
/**
* Mount the Session provider before the Task Board authority.
* @param ctx - Host context used to mount both owned plugins.
* @param config - Validated Task Board text limits.
* @returns Async disposer sequence owned by the root plugin effect.
*/
async function* createTaskBoardComposition(ctx, config) {
	const session = ctx.plugin(ApiProxyTaskBoardSessionGateway);
	await session.await();
	yield session.dispose;
	const taskBoard = ctx.plugin(TaskBoardService, config);
	await taskBoard.await();
	yield taskBoard.dispose;
}
/**
* Activate the single Loader entry and own both Host plugins.
* @param ctx - Host Cordis context.
* @param config - Validated Task Board text limits.
*/
async function apply(ctx, config) {
	await ctx.effect(() => createTaskBoardComposition(ctx, config), "task-board.community.composition");
}
//#endregion
export { Config, TaskBoardService, TaskBoardSessionGateway, apply, createTaskBoardComposition };
