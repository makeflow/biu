import _ from 'lodash';
import {action, observable} from 'mobx';
import {
  Corner,
  MosaicBranch,
  MosaicDirection,
  MosaicNode,
  MosaicParent,
  createBalancedTreeFromLeaves,
  createRemoveUpdate,
  getLeaves,
  getNodeAtPath,
  getOtherDirection,
  getPathToCorner,
  updateTree,
} from 'react-mosaic-component';

import {deepCopy} from 'utils/lang';
import {appendOutput, outputError, outputInfo} from 'utils/output';
import {getStorageObject, setStorageObject} from 'utils/storage';

import {SocketIOService} from './socket-io-service';

export type TaskName = string;
export type TaskId = string;

export enum TaskStatus {
  ready,
  running,
  stopped,
  stopping,
  restarting,
}

export interface Task {
  id?: TaskId;
  name: string;
  line?: string;
  running: boolean;
  status: TaskStatus;
  output: string;
}

export interface CreatedTask extends Task {
  id: TaskId;
}

export interface TaskRef {
  id: TaskId;
}

export interface TaskGroupDict {
  [key: string]: string[];
}

export interface TaskDict {
  [key: string]: Task;
}

export interface InitializeData {
  createdTasks: CreatedTask[];
  taskGroups: TaskGroupDict;
  taskNames: string[];
}

export interface ErrorData {
  id: TaskId;
  error: string;
}

export interface ExitData {
  id: TaskId;
  code?: string;
}

export interface StdOutData {
  id: TaskId;
  html: string;
}

export interface StdErrData {
  id: TaskId;
  html: string;
}

export class TaskService {
  @observable
  connected = false;

  @observable
  taskGroups: TaskGroupDict = {};

  @observable
  tasks: TaskDict = {};

  @observable
  createdTaskMap = new Map<TaskId, CreatedTask>();

  @observable
  currentNode: MosaicNode<TaskId> | null = null;

  @observable
  currentHoverTaskId: TaskId | undefined;

  lastTaskList: TaskName[] = [];

  constructor(private socketIOService: SocketIOService) {
    this.socketIOService.on('connect', this.onConnect);
    this.socketIOService.on('disconnect', this.onDisconnect);
    this.socketIOService.on('initialize', this.onInitialize);
    this.socketIOService.on('create', this.onCreate);
    this.socketIOService.on('close', this.onClose);
    this.socketIOService.on('start', this.onStart);
    this.socketIOService.on('stop', this.onStop);
    this.socketIOService.on('restarting-on-change', this.onRestartOnChange);
    this.socketIOService.on('error', this.onError);
    this.socketIOService.on('exit', this.onExit);
    this.socketIOService.on('stdout', this.onStdOut);
    this.socketIOService.on('stderr', this.onStdErr);
  }

  isCreated(task: Task): task is CreatedTask {
    let {id} = task;

    return typeof id !== 'undefined' && this.createdTaskMap.has(id);
  }

  start(task: Task): void {
    if (!this.isCreated(task)) {
      let {name} = task;

      this.socketIOService.emit('create', {names: [name]});
    } else if (!task.running) {
      let {id} = task;

      this.socketIOService.emit('start', {id});
    }
  }

  startGroup(groupName: string): void {
    let tasks = this.filterTasksInGroup(Object.values(this.tasks), groupName);

    for (let task of tasks) {
      this.start(task);
    }
  }

  startAll(): void {
    for (let task of this.createdTaskMap.values()) {
      this.start(task);
    }
  }

  @action
  restart(task: Task): void {
    if (!this.isCreated(task)) {
      return;
    }

    let {id} = task;

    task.status = TaskStatus.restarting;

    this.socketIOService.emit('restart', {id});
  }

  restartGroup(groupName: string): void {
    let tasks = this.filterTasksInGroup(
      Array.from(this.createdTaskMap.values()),
      groupName,
    );

    for (let task of tasks) {
      this.restart(task);
    }
  }

  restartAll(): void {
    for (let task of this.createdTaskMap.values()) {
      this.restart(task);
    }
  }

  @action
  stop(task: Task): void {
    if (
      !this.isCreated(task) ||
      (task.status !== TaskStatus.running &&
        task.status !== TaskStatus.restarting)
    ) {
      return;
    }

    let {id} = task;

    task.status = TaskStatus.stopping;

    this.socketIOService.emit('stop', {id});
  }

  stopGroup(groupName: string): void {
    let tasks = this.filterTasksInGroup(
      Array.from(this.createdTaskMap.values()),
      groupName,
    );

    for (let task of tasks) {
      this.stop(task);
    }
  }

  stopAll(): void {
    for (let task of this.createdTaskMap.values()) {
      this.stop(task);
    }
  }

  @action
  close(task: Task): void {
    if (!this.isCreated(task)) {
      return;
    }

    let {id, running} = task;

    if (running) {
      task.status = TaskStatus.stopping;
    }

    this.socketIOService.emit('close', {id});
  }

  closeGroup(groupName: string): void {
    let tasks = this.filterTasksInGroup(
      Array.from(this.createdTaskMap.values()),
      groupName,
    );

    for (let task of tasks) {
      this.close(task);
    }
  }

  closeAll(): void {
    for (let task of this.createdTaskMap.values()) {
      this.close(task);
    }
  }

  @action
  autoArrangeWindows(): void {
    let leaves = getLeaves(this.currentNode);

    this.currentNode = createBalancedTreeFromLeaves(leaves);
  }

  restoreNode(node: MosaicNode<TaskId> | null): MosaicNode<TaskId> | null {
    if (node) {
      let {
        taskList,
        taskNameToIdMap,
      } = this.getTaskListAndTaskNameAndIdMapOutOfNode(node);

      try {
        let storedNode = getLayoutFromStorage(taskList, taskNameToIdMap);

        if (storedNode) {
          return storedNode;
        }
      } catch (error) {
        console.error(error);
      }
    }

    return node;
  }

  saveNodeLayout(node: MosaicNode<TaskId> | null): void {
    if (node) {
      let {
        taskList,
        taskIdToNameMap,
      } = this.getTaskListAndTaskNameAndIdMapOutOfNode(node);

      if (
        !this.lastTaskList ||
        getLayoutStorageKey(taskList) !== getLayoutStorageKey(this.lastTaskList)
      ) {
        this.lastTaskList = taskList;

        return;
      } else {
        this.lastTaskList = taskList;

        try {
          setLayoutToStorage(taskList, node, taskIdToNameMap);
        } catch (error) {
          console.error(error);
        }
      }
    }
  }

  private getTaskListAndTaskNameAndIdMapOutOfNode(
    node: MosaicNode<TaskId>,
  ): {
    taskList: string[];
    taskNameToIdMap: Map<TaskName, TaskId>;
    taskIdToNameMap: Map<TaskId, TaskName>;
  } {
    let taskList: string[] = [];
    let taskNameToIdMap = new Map<TaskName, TaskId>();
    let taskIdToNameMap = new Map<TaskId, TaskName>();

    let leaves = getLeaves(node);

    for (let leave of leaves) {
      let task = this.createdTaskMap.get(leave);

      if (task) {
        taskList.push(task.name);
        taskNameToIdMap.set(task.name, leave);
        taskIdToNameMap.set(leave, task.name);
      }
    }

    taskList = taskList.sort();

    return {taskList, taskNameToIdMap, taskIdToNameMap};
  }

  private filterTasksInGroup(tasks: Task[], groupName: string): Task[] {
    let result: Task[] = [];

    if (!(groupName in this.taskGroups)) {
      return result;
    }

    let taskNamesInGroup = this.taskGroups[groupName];

    for (let task of tasks) {
      let {name} = task;

      if (taskNamesInGroup.includes(name)) {
        result.push(task);
      }
    }

    return result;
  }

  private getCreatedTaskByTaskId(id: TaskId): CreatedTask | undefined {
    let task = this.createdTaskMap.get(id);

    if (!task) {
      return undefined;
    }

    let {name} = task;

    return this.tasks[name] as CreatedTask;
  }

  private freshCurrentNode(): void {
    let createdTaskIds = Array.from(this.createdTaskMap.keys());
    let currentNodeIds = getLeaves(this.currentNode);

    let newTaskIds = _.difference(createdTaskIds, currentNodeIds);
    let removedTaskIds = _.difference(currentNodeIds, createdTaskIds);

    for (let taskId of removedTaskIds) {
      this.closeTaskWindow(taskId);
    }

    for (let newTaskId of newTaskIds) {
      this.addToBottomRight(newTaskId);
    }
  }

  @action
  private addToBottomRight = (taskId: TaskId): void => {
    let currentNode = this.currentNode;

    if (currentNode) {
      const path = getPathToCorner(currentNode, Corner.BOTTOM_RIGHT);
      const parent = getNodeAtPath(
        currentNode,
        _.dropRight(path),
      ) as MosaicParent<TaskId>;
      const destination = getNodeAtPath(currentNode, path) as MosaicNode<
        TaskId
      >;
      const direction: MosaicDirection = parent
        ? getOtherDirection(parent.direction)
        : 'row';
      let first: MosaicNode<TaskId>;
      let second: MosaicNode<TaskId>;

      first = destination;
      second = taskId;

      this.currentNode = updateTree(currentNode, [
        {
          path,
          spec: {
            $set: {
              direction,
              first,
              second,
            },
          },
        },
      ]);
    } else {
      this.currentNode = taskId;
    }
  };

  @action
  private closeTaskWindow(taskId: TaskId): void {
    if (this.currentNode) {
      let path = getPathByTaskIdInNode(this.currentNode, taskId);

      if (typeof path === 'object') {
        let update = createRemoveUpdate(this.currentNode, path);

        this.currentNode = updateTree(this.currentNode, [update]);
      } else if (path === 'clean') {
        this.currentNode = null;
      }
    }
  }

  @action
  private onConnect = (): void => {
    this.connected = true;
  };

  @action
  private onDisconnect = (): void => {
    this.connected = false;
  };

  @action
  private onInitialize = ({
    createdTasks,
    taskGroups,
    taskNames,
  }: InitializeData): void => {
    this.taskGroups = {};
    this.tasks = {};
    this.createdTaskMap = new Map<TaskId, CreatedTask>();
    this.currentNode = null;
    this.currentHoverTaskId = undefined;

    if (taskGroups) {
      this.taskGroups = taskGroups;
    }

    if (taskNames) {
      for (let taskName of taskNames) {
        this.tasks[taskName] = {
          name: taskName,
          running: false,
          status: TaskStatus.ready,
          output: '',
        };
      }
    }

    let createdLeaves: TaskId[] = [];

    for (let task of createdTasks) {
      let {id, name} = task;

      task.status = task.running ? TaskStatus.running : TaskStatus.stopped;

      task.output = '';

      this.tasks[name] = task;

      this.createdTaskMap.set(id, task);

      createdLeaves.push(id);
    }

    this.currentNode = createBalancedTreeFromLeaves(createdLeaves);

    this.freshCurrentNode();
  };

  @action
  private onCreate = (task: CreatedTask): void => {
    let {id, name} = task;

    task.running = true;
    task.status = TaskStatus.running;

    this.tasks[name] = task;

    this.createdTaskMap.set(id, task);

    this.freshCurrentNode();
  };

  @action
  private onClose = (taskRef: TaskRef): void => {
    let {id} = taskRef;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    task.running = false;
    task.status = TaskStatus.ready;

    this.createdTaskMap.delete(id);

    this.freshCurrentNode();
  };

  @action
  private onStart = (taskRef: TaskRef): void => {
    let {id} = taskRef;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    task.running = true;
    task.status = TaskStatus.running;

    task.output = appendOutput(
      task.output,
      outputInfo('[biu] Task started.'),
      'system',
    );

    this.createdTaskMap.set(id, task);
  };

  @action
  private onStop = (taskRef: TaskRef): void => {
    let {id} = taskRef;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    task.running = false;
    task.status = TaskStatus.stopped;

    this.createdTaskMap.set(id, task);
  };

  @action
  private onRestartOnChange = (taskRef: TaskRef): void => {
    let {id} = taskRef;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    task.running = false;
    task.status = TaskStatus.restarting;

    task.output = appendOutput(
      task.output,
      outputInfo('[biu] Restarting on change...'),
      'system',
    );

    this.createdTaskMap.set(id, task);
  };

  @action
  private onError = (data: ErrorData): void => {
    let {id, error} = data;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    task.output = appendOutput(
      task.output,
      outputError(error.replace(/\n/g, '<br />')),
      'system',
    );

    this.createdTaskMap.set(id, task);
  };

  @action
  private onExit = (data: ExitData): void => {
    let {id, code} = data;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    let text = code
      ? `[biu] Task exited with code ${data.code}.`
      : '[biu] Task exited.';

    task.output = appendOutput(task.output, outputInfo(text), 'system');

    this.createdTaskMap.set(id, task);
  };

  @action
  private onStdOut = (data: StdOutData): void => {
    let {id, html} = data;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    if (html) {
      task.output = appendOutput(task.output, html);
    }

    this.createdTaskMap.set(id, task);
  };

  @action
  private onStdErr = (data: StdErrData): void => {
    let {id, html} = data;

    let task = this.getCreatedTaskByTaskId(id);

    if (!task) {
      return;
    }

    if (html) {
      task.output = appendOutput(task.output, html);
    }

    this.createdTaskMap.set(id, task);
  };
}

export function getTaskStatus(task: Task | undefined): string {
  if (!task) {
    return 'closed';
  }

  let {status, line} = task;

  switch (status) {
    case TaskStatus.ready:
      return 'ready';
    case TaskStatus.running:
      return line ? line : 'running';
    case TaskStatus.stopped:
      return 'stopped';
    case TaskStatus.stopping:
      return 'stopping';
    case TaskStatus.restarting:
      return 'restarting';
  }
}

export function getLayoutStorageKey(taskList: TaskName[]): string {
  return `layout-${taskList.sort().join('|')}`;
}

export function getLayoutFromStorage(
  taskList: TaskName[],
  taskNameToIdMap: Map<TaskName, TaskId>,
): MosaicNode<TaskId> | undefined {
  if (taskList.length > 1) {
    let key = getLayoutStorageKey(taskList);

    let innerMosaicNode = getStorageObject<MosaicNode<TaskName>>(key);

    if (innerMosaicNode) {
      let newMosaicNode = convertMosaicNode<TaskName, TaskId>(
        innerMosaicNode,
        taskNameToIdMap,
      );

      return newMosaicNode;
    }
  }

  return undefined;
}

export function setLayoutToStorage(
  taskList: TaskName[],
  node: MosaicNode<TaskId>,
  taskIdToNameMap: Map<TaskId, TaskName>,
): void {
  if (taskList.length > 1) {
    let key = getLayoutStorageKey(taskList);

    let nodeCopy = deepCopy(node);

    let mosaicNode = convertMosaicNode<TaskId, TaskName>(
      nodeCopy,
      taskIdToNameMap,
    );

    if (mosaicNode) {
      setStorageObject(key, mosaicNode);
    }
  }
}

export function convertMosaicNode<
  FromIdType extends string,
  ToIdType extends string
>(
  fromNode: MosaicNode<FromIdType>,
  idMap: Map<FromIdType, ToIdType>,
): MosaicNode<ToIdType> {
  if (typeof fromNode === 'string') {
    let toId = idMap.get(fromNode);

    if (!toId) {
      throw new Error(`fromId: '${fromNode}' fromId not found in \`idMap\``);
    }

    return toId;
  } else {
    fromNode.first = convertMosaicNode<FromIdType, ToIdType>(
      fromNode.first,
      idMap,
    ) as any;
    fromNode.second = convertMosaicNode<FromIdType, ToIdType>(
      fromNode.second,
      idMap,
    ) as any;

    return fromNode as any;
  }
}

export function getPathByTaskIdInNode(
  node: MosaicNode<TaskId> | TaskId | undefined,
  taskId: TaskId,
  path?: string,
): MosaicBranch[] | 'clean' | undefined {
  if (typeof node === 'string' && node === taskId) {
    if (path) {
      return path.split('|') as MosaicBranch[];
    } else {
      return 'clean';
    }
  } else if (typeof node === 'object') {
    let firstBranchResult = getPathByTaskIdInNode(
      node['first'],
      taskId,
      path ? `${path}|first` : 'first',
    );

    if (firstBranchResult) {
      return firstBranchResult;
    }

    let secondBranchResult = getPathByTaskIdInNode(
      node['second'],
      taskId,
      path ? `${path}|second` : 'second',
    );

    if (secondBranchResult) {
      return secondBranchResult;
    }
  }

  return undefined;
}
