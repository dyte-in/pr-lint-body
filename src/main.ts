import * as core from "@actions/core";
import * as github from "@actions/github";

const repoTokenInput = core.getInput("repo-token", { required: true });
const octokit = github.getOctokit(repoTokenInput);

const bodyRegexInput: string = core.getInput("body-regex", {
  required: false,
});
const bodyRegexFlagsInput: string = core.getInput("body-regex-flags", {
  required: false,
});
const onFailedRegexCreateReviewInput: boolean =
  core.getInput("on-failed-regex-create-review") === "true";
const onFailedRegexCommentInput: string = core.getInput(
  "on-failed-regex-comment"
);
const onFailedRegexFailActionInput: boolean =
  core.getInput("on-failed-regex-fail-action") === "true";
const onFailedRegexRequestChanges: boolean =
  core.getInput("on-failed-regex-request-changes") === "true";
const onSucceededRegexDismissReviewComment: string = core.getInput(
  "on-succeeded-regex-dismiss-review-comment"
);

async function run(): Promise<void> {
  const githubContext = github.context;
  const pullRequest = githubContext.issue;

  const body: string = githubContext.payload.pull_request?.body ?? "";
  const bodyRegex = new RegExp(bodyRegexInput, bodyRegexFlagsInput);
  const comment = onFailedRegexCommentInput.replace(
    "%regex%",
    bodyRegex.source
  );

  core.info(`Body Regex: ${bodyRegex.source}`);

  if (!body) {
    core.warning("Body is empty!");
  } else {
    core.info(`Body: ${body}`);
  }

  const bodyMatchesRegex: boolean = bodyRegex.test(body);
  if (!bodyMatchesRegex) {
    if (onFailedRegexCreateReviewInput) {
      createReview(comment, pullRequest);
    }
    if (onFailedRegexFailActionInput) {
      core.setFailed(comment);
    }
    core.info((body && `Failing body: ${body}`) ?? "Body is empty!");
  } else {
    core.debug(`Regex pass`);
    if (onFailedRegexCreateReviewInput) {
      core.debug(`Dismissing review`);
      await dismissReview(pullRequest);
      core.debug(`Review dimissed`);
    }
  }
}

function createReview(
  comment: string,
  pullRequest: { owner: string; repo: string; number: number }
) {
  void octokit.rest.pulls.createReview({
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    pull_number: pullRequest.number,
    body: `body-linter: ${comment}`,
    event: onFailedRegexRequestChanges ? "REQUEST_CHANGES" : "COMMENT",
  });
}

async function dismissReview(pullRequest: {
  owner: string;
  repo: string;
  number: number;
}) {
  const reviews = await octokit.rest.pulls.listReviews({
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    pull_number: pullRequest.number,
  });

  reviews.data.forEach(
    (review: { id: number; user: { login: string } | null; state: string; body: string; }) => {
      if (
        review.user != null &&
        isGitHubActionUser(review.user.login) &&
        alreadyRequiredChanges(review.state) &&
        review.body.startsWith("body-linter:")
      ) {
        core.debug(`Already required changes`);
        if (review.state === "COMMENTED") {
          octokit.rest.issues.createComment({
            owner: pullRequest.owner,
            repo: pullRequest.repo,
            issue_number: pullRequest.number,
            body: onSucceededRegexDismissReviewComment,
          });
        } else {
          try {
            octokit.rest.pulls.dismissReview({
              owner: pullRequest.owner,
              repo: pullRequest.repo,
              pull_number: pullRequest.number,
              review_id: review.id,
              message: onSucceededRegexDismissReviewComment,
            });
          } catch (err) {
            core.warning(`Something went wrong dismissing review: ${err}`);
          }
        }
      }
    }
  );
}

function isGitHubActionUser(login: string) {
  const gitHubUser = login === "github-actions[bot]";
  core.debug(`isGitHubActionUser output: ${gitHubUser} (login is: ${login})`);
  return gitHubUser;
}

function alreadyRequiredChanges(state: string) {
  // If on-failed-regex-request-changes is set to be true state will be CHANGES_REQUESTED
  // otherwise the bot will just comment and the state will be COMMENTED.
  const requiredChanges =
    state === "CHANGES_REQUESTED" || state === "COMMENTED";
  core.debug(
    `alreadyRequiredChanges output: ${requiredChanges} (state is: ${state})`
  );
  return requiredChanges;
}

run().catch((error) => {
  core.setFailed(error);
});
