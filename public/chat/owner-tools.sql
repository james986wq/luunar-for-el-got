-- Run this AFTER the existing chat/schema.sql in Supabase SQL Editor.
-- Site-wide owner identity is checked against the authenticated JWT email.
alter table public.server_members add column if not exists tag text check(tag is null or char_length(tag) between 1 and 24);
create table if not exists public.chat_bans(user_id uuid primary key references public.profiles(id) on delete cascade,reason text,banned_at timestamptz not null default now(),banned_by uuid references public.profiles(id));
alter table public.chat_bans enable row level security;
create or replace function public.lunaar_is_owner() returns boolean language sql stable security definer set search_path=public,auth as $$ select lower(coalesce(auth.jwt()->>'email',''))='jamessklar9@gmail.com' $$;
create or replace function public.lunaar_is_banned() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.chat_bans where user_id=auth.uid()) $$;
create or replace function public.lunaar_get_tags() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('username',p.username,'tag',m.tag)),'[]'::jsonb)
 from public.server_members m join public.profiles p on p.id=m.user_id
 where m.tag is not null and m.server_id in (select mine.server_id from public.server_members mine where mine.user_id=auth.uid())
$$;
create or replace function public.lunaar_owner_list() returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare result jsonb;
begin
 if not public.lunaar_is_owner() then raise exception 'Owner access required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'members',(select coalesce(jsonb_agg(jsonb_build_object('server_id',s.id,'user_id',m.user_id,'username',p.username,'email',u.email,'role',m.role,'tag',m.tag) order by p.username),'[]'::jsonb) from public.server_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id where m.server_id=s.id) ) order by s.name),'[]'::jsonb) into result from public.servers s;
 return result;
end $$;
create or replace function public.lunaar_owner_set_role(p_server uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.lunaar_is_owner() then raise exception 'Owner access required'; end if;
 if p_role not in ('member','admin') then raise exception 'Role must be member or admin'; end if;
 update public.server_members set role=p_role where server_id=p_server and user_id=p_user and role<>'owner';
 if not found then raise exception 'Member not found or cannot change server owner'; end if;
end $$;
create or replace function public.lunaar_owner_set_tag(p_server uuid,p_user uuid,p_tag text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.lunaar_is_owner() then raise exception 'Owner access required'; end if;
 if p_tag is not null and char_length(trim(p_tag)) not between 1 and 24 then raise exception 'Tag must be 1–24 characters'; end if;
 update public.server_members set tag=nullif(trim(p_tag),'') where server_id=p_server and user_id=p_user;
 if not found then raise exception 'Member not found'; end if;
end $$;
create or replace function public.lunaar_owner_ban(p_user uuid,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.lunaar_is_owner() then raise exception 'Owner access required'; end if;
 if p_user=auth.uid() then raise exception 'You cannot ban your owner account'; end if;
 insert into public.chat_bans(user_id,reason,banned_by) values(p_user,left(coalesce(p_reason,''),240),auth.uid()) on conflict(user_id) do update set reason=excluded.reason,banned_at=now(),banned_by=auth.uid();
 delete from public.server_members where user_id=p_user;
end $$;
-- Promote the designated owner to owner in every existing server and transfer ownership.
do $$ declare owner_uid uuid; begin
 select id into owner_uid from auth.users where lower(email)='jamessklar9@gmail.com' limit 1;
 if owner_uid is not null then
   update public.servers set owner_id=owner_uid;
   insert into public.server_members(server_id,user_id,role) select id,owner_uid,'owner' from public.servers on conflict(server_id,user_id) do update set role='owner';
 end if;
end $$;
-- Prevent banned accounts from rejoining or sending messages.
create or replace function public.join_server(code text) returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 if public.lunaar_is_banned() then raise exception 'This account is banned from Lunaar Chat'; end if;
 select id into sid from public.servers where invite_code=lower(trim(code));
 if sid is null then raise exception 'Invalid invite code'; end if;
 insert into public.server_members(server_id,user_id,role) values(sid,auth.uid(),'member') on conflict do nothing;
 return sid;
end $$;
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check(user_id=auth.uid() and public.channel_is_member(channel_id) and not public.lunaar_is_banned());
drop policy if exists dm_insert on public.dm_messages;
create policy dm_insert on public.dm_messages for insert to authenticated with check(sender_id=auth.uid() and not public.lunaar_is_banned());
drop policy if exists members_select on public.server_members;
create policy members_select on public.server_members for select to authenticated using(public.is_member(server_id) or public.lunaar_is_owner());
drop policy if exists members_role on public.server_members;
create policy members_role on public.server_members for update to authenticated using((public.is_owner(server_id) or public.lunaar_is_owner()) and role<>'owner') with check((public.is_owner(server_id) or public.lunaar_is_owner()) and role in('admin','member'));
drop policy if exists members_kick on public.server_members;
create policy members_kick on public.server_members for delete to authenticated using((public.is_admin(server_id) or public.lunaar_is_owner()) and role<>'owner' and user_id<>auth.uid());
revoke all on function public.lunaar_is_owner() from public,anon;
revoke all on function public.lunaar_is_banned() from public,anon;
revoke all on function public.lunaar_owner_list() from public,anon;
revoke all on function public.lunaar_owner_set_role(uuid,uuid,text) from public,anon;
revoke all on function public.lunaar_owner_set_tag(uuid,uuid,text) from public,anon;
revoke all on function public.lunaar_owner_ban(uuid,text) from public,anon;
grant execute on function public.lunaar_is_banned() to authenticated;
grant execute on function public.lunaar_get_tags() to authenticated;
grant execute on function public.lunaar_owner_list() to authenticated;
grant execute on function public.lunaar_owner_set_role(uuid,uuid,text) to authenticated;
grant execute on function public.lunaar_owner_set_tag(uuid,uuid,text) to authenticated;
grant execute on function public.lunaar_owner_ban(uuid,text) to authenticated;
grant execute on function public.join_server(text) to authenticated;
