import {
  createAndPopulateGroup,
  translate as t,
} from '../../../../../helpers/api-integration/v3';
import { find } from 'lodash';

describe('POST /tasks/:id/score/:direction', () => {
  let user, guild, member, member2, task;

  function findAssignedTask (memberTask) {
    return memberTask.group.id === guild._id;
  }

  beforeEach(async () => {
    let {group, members, groupLeader} = await createAndPopulateGroup({
      groupDetails: {
        name: 'Test Guild',
        type: 'guild',
      },
      members: 2,
    });

    guild = group;
    user = groupLeader;
    member = members[0];
    member2 = members[1];

    task = await user.post(`/tasks/group/${guild._id}`, {
      text: 'test todo',
      type: 'todo',
      requiresApproval: true,
    });

    await user.post(`/tasks/${task._id}/assign/${member._id}`);
  });

  it('prevents user from scoring a task that needs to be approved', async () => {
    await user.update({
      'preferences.language': 'cs',
    });

    let memberTasks = await member.get('/tasks/user');
    let syncedTask = find(memberTasks, findAssignedTask);
    const direction = 'up';

    await expect(member.post(`/tasks/${syncedTask._id}/score/${direction}`))
      .to.eventually.be.rejected.and.to.eql({
        code: 401,
        error: 'NotAuthorized',
        message: t('taskApprovalHasBeenRequested'),
      });
    let updatedTask = await member.get(`/tasks/${syncedTask._id}`);

    await user.sync();

    expect(user.notifications.length).to.equal(2);
    expect(user.notifications[1].type).to.equal('GROUP_TASK_APPROVAL');
    expect(user.notifications[1].data.message).to.equal(t('userHasRequestedTaskApproval', {
      user: member.auth.local.username,
      taskName: updatedTask.text,
      taskId: updatedTask._id,
      direction,
    }, 'cs')); // This test only works if we have the notification translated
    expect(user.notifications[1].data.groupId).to.equal(guild._id);

    expect(updatedTask.group.approval.requested).to.equal(true);
    expect(updatedTask.group.approval.requestedDate).to.be.a('string'); // date gets converted to a string as json doesn't have a Date type
  });

  it('sends notifications to all managers', async () => {
    await user.post(`/groups/${guild._id}/add-manager`, {
      managerId: member2._id,
    });
    let memberTasks = await member.get('/tasks/user');
    let syncedTask = find(memberTasks, findAssignedTask);
    const direction = 'up';

    await expect(member.post(`/tasks/${syncedTask._id}/score/${direction}`))
      .to.eventually.be.rejected.and.to.eql({
        code: 401,
        error: 'NotAuthorized',
        message: t('taskApprovalHasBeenRequested'),
      });
    let updatedTask = await member.get(`/tasks/${syncedTask._id}`);
    await user.sync();
    await member2.sync();

    expect(user.notifications.length).to.equal(2);
    expect(user.notifications[1].type).to.equal('GROUP_TASK_APPROVAL');
    expect(user.notifications[1].data.message).to.equal(t('userHasRequestedTaskApproval', {
      user: member.auth.local.username,
      taskName: updatedTask.text,
      taskId: updatedTask._id,
      direction,
    }));
    expect(user.notifications[1].data.groupId).to.equal(guild._id);

    expect(member2.notifications.length).to.equal(1);
    expect(member2.notifications[0].type).to.equal('GROUP_TASK_APPROVAL');
    expect(member2.notifications[0].data.message).to.equal(t('userHasRequestedTaskApproval', {
      user: member.auth.local.username,
      taskName: updatedTask.text,
      taskId: updatedTask._id,
      direction,
    }));
    expect(member2.notifications[0].data.groupId).to.equal(guild._id);
  });

  it('errors when approval has already been requested', async () => {
    let memberTasks = await member.get('/tasks/user');
    let syncedTask = find(memberTasks, findAssignedTask);

    await expect(member.post(`/tasks/${syncedTask._id}/score/up`))
      .to.eventually.be.rejected.and.to.eql({
        code: 401,
        error: 'NotAuthorized',
        message: t('taskApprovalHasBeenRequested'),
      });

    await expect(member.post(`/tasks/${syncedTask._id}/score/up`))
      .to.eventually.be.rejected.and.eql({
        code: 401,
        error: 'NotAuthorized',
        message: t('taskRequiresApproval'),
      });
  });

  it('allows a user to score an approved task', async () => {
    let memberTasks = await member.get('/tasks/user');
    let syncedTask = find(memberTasks, findAssignedTask);

    await user.post(`/tasks/${task._id}/approve/${member._id}`);

    await member.post(`/tasks/${syncedTask._id}/score/up`);
    let updatedTask = await member.get(`/tasks/${syncedTask._id}`);

    expect(updatedTask.completed).to.equal(true);
    expect(updatedTask.dateCompleted).to.be.a('string'); // date gets converted to a string as json doesn't have a Date type
  });

  it('completes master task when single-completion task is completed', async () => {
    let sharedCompletionTask = await user.post(`/tasks/group/${guild._id}`, {
      text: 'shared completion todo',
      type: 'todo',
      requiresApproval: false,
      sharedCompletion: 'singleCompletion',
    });

    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member._id}`);
    let memberTasks = await member.get('/tasks/user');

    let syncedTask = find(memberTasks, (memberTask) => {
      return memberTask.group.taskId === sharedCompletionTask._id;
    });

    await member.post(`/tasks/${syncedTask._id}/score/up`);

    let groupTasks = await user.get(`/tasks/group/${guild._id}?type=completedTodos`);
    let masterTask = find(groupTasks, (groupTask) => {
      return groupTask._id === sharedCompletionTask._id;
    });

    expect(masterTask.completed).to.equal(true);
  });

  it('deletes other assigned user tasks when single-completion task is completed', async () => {
    let sharedCompletionTask = await user.post(`/tasks/group/${guild._id}`, {
      text: 'shared completion todo',
      type: 'todo',
      requiresApproval: false,
      sharedCompletion: 'singleCompletion',
    });

    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member._id}`);
    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member2._id}`);
    let memberTasks = await member.get('/tasks/user');

    let syncedTask = find(memberTasks, (memberTask) => {
      return memberTask.group.taskId === sharedCompletionTask._id;
    });

    await member.post(`/tasks/${syncedTask._id}/score/up`);

    let member2Tasks = await member2.get('/tasks/user');

    let syncedTask2 = find(member2Tasks, (memberTask) => {
      return memberTask.group.taskId === sharedCompletionTask._id;
    });

    expect(syncedTask2).to.equal(undefined);
  });

  it('does not complete master task when not all user tasks are completed if all assigned must complete', async () => {
    let sharedCompletionTask = await user.post(`/tasks/group/${guild._id}`, {
      text: 'shared completion todo',
      type: 'todo',
      requiresApproval: false,
      sharedCompletion: 'allAssignedCompletion',
    });

    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member._id}`);
    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member2._id}`);
    let memberTasks = await member.get('/tasks/user');

    let syncedTask = find(memberTasks, (memberTask) => {
      return memberTask.group.taskId === sharedCompletionTask._id;
    });

    await member.post(`/tasks/${syncedTask._id}/score/up`);

    let groupTasks = await user.get(`/tasks/group/${guild._id}`);
    let masterTask = find(groupTasks, (groupTask) => {
      return groupTask._id === sharedCompletionTask._id;
    });

    expect(masterTask.completed).to.equal(false);
  });

  it('completes master task when all user tasks are completed if all assigned must complete', async () => {
    let sharedCompletionTask = await user.post(`/tasks/group/${guild._id}`, {
      text: 'shared completion todo',
      type: 'todo',
      requiresApproval: false,
      sharedCompletion: 'allAssignedCompletion',
    });

    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member._id}`);
    await user.post(`/tasks/${sharedCompletionTask._id}/assign/${member2._id}`);
    let memberTasks = await member.get('/tasks/user');
    let member2Tasks = await member2.get('/tasks/user');
    let syncedTask = find(memberTasks, (memberTask) => {
      return memberTask.group.taskId === sharedCompletionTask._id;
    });
    let syncedTask2 = find(member2Tasks, (memberTask) => {
      return memberTask.group.taskId === sharedCompletionTask._id;
    });

    await member.post(`/tasks/${syncedTask._id}/score/up`);
    await member2.post(`/tasks/${syncedTask2._id}/score/up`);

    let groupTasks = await user.get(`/tasks/group/${guild._id}?type=completedTodos`);
    let masterTask = find(groupTasks, (groupTask) => {
      return groupTask._id === sharedCompletionTask._id;
    });

    expect(masterTask.completed).to.equal(true);
  });
});
