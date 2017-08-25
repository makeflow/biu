import { ProblemMatcherPatternBase } from './problem-matcher';

export interface ProblemMatcherPatternConfig extends ProblemMatcherPatternBase {
  regexp: string;
}

export interface ProblemMatcherWatchingConfig {
  activeOnStart: boolean;
  beginsPattern: string;
  endsPattern: string;
}

export interface ProblemMatcherConfig {
  owner: string;
  pattern: ProblemMatcherPatternConfig | ProblemMatcherPatternConfig[];
  watching?: ProblemMatcherWatchingConfig;
}

export interface TaskConfig {
  executable: string;
  args?: string[];
  cwd?: string;
  stdout?: boolean;
  stderr?: boolean;
  watch?: string | string[];
  problemMatcher?: string | ProblemMatcherConfig;
  autoClose?: boolean;
}

export interface Config {
  problemMatchers: Dictionary<ProblemMatcherConfig> | undefined;
  tasks: Dictionary<TaskConfig>;
  groups: Dictionary<string[]> | undefined;
}
